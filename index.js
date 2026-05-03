import http from "node:http";
import crypto from "node:crypto";
import express from "express";
import { Server } from "socket.io";
import { createClient } from "redis";
import "dotenv/config";
import axios from "axios";
import cookieParser from "cookie-parser";
import session from "express-session";
import jwt from "jsonwebtoken";

const CHECKBOX_KEY = "checkbox_state";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const TOTAL_CHECKBOXES = 1_000_000;

async function main() {
  const app = express();
  const server = http.createServer(app);
  const PORT = process.env.PORT || 8000;
  const io = new Server(server);

  const redisClient = createClient({ url: REDIS_URL });
  const pubClient = createClient({ url: REDIS_URL });
  const subClient = pubClient.duplicate();

  await Promise.all([
    redisClient.connect(),
    pubClient.connect(),
    subClient.connect(),
  ]);

  console.log("Connected to Redis");

  app.use(express.static("public"));
  app.use(express.json());
  app.use(cookieParser());

  const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || "default_secret",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  });

  app.use(sessionMiddleware);

  io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
  });

  const rateLimit = async (key, limit, window) => {
    const current = await redisClient.incr(key);
    if (current === 1) {
      await redisClient.expire(key, window);
    }
    return current <= limit;
  };

  const {
    IDP_URL,
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI,
    POST_LOGOUT_REDIRECT_URI,
  } = process.env;

  app.get("/login", (req, res) => {
    const state = crypto.randomBytes(16).toString("hex");
    const codeVerifier = crypto.randomBytes(32).toString("hex");
    const codeChallenge = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");

    req.session.oidcState = state;
    req.session.codeVerifier = codeVerifier;

    const authUrl = `${IDP_URL}/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
      REDIRECT_URI,
    )}&response_type=code&scope=openid profile email&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

    res.redirect(authUrl);
  });

  app.get("/callback", async (req, res) => {
    const { code, state } = req.query;

    if (state !== req.session.oidcState) {
      return res.status(400).send("State mismatch");
    }

    try {
      const response = await axios.post(
        `${IDP_URL}/token`,
        new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code_verifier: req.session.codeVerifier,
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      );

      const { access_token, id_token } = response.data;

      const decoded = jwt.decode(id_token);
      req.session.user = decoded;
      req.session.accessToken = access_token;

      res.redirect("/");
    } catch (error) {
      console.error(
        "Token exchange failed:",
        error.response?.data || error.message,
      );
      res.status(500).send("Authentication failed");
    }
  });

  app.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect(
      `${IDP_URL}/auth/logout?client_id=${CLIENT_ID}&post_logout_redirect_uri=${encodeURIComponent(POST_LOGOUT_REDIRECT_URI)}`,
    );
  });

  app.get("/me", (req, res) => {
    res.json({ user: req.session.user || null });
  });

  subClient.subscribe("checkbox:update", (message) => {
    const data = JSON.parse(message);
    io.emit("server:checkbox:change", data);
  });

  io.on("connection", async (socket) => {
    console.log("User connected:", socket.id);

    socket.on("client:request:range", async ({ start, end }) => {
      if (start < 0 || end >= TOTAL_CHECKBOXES || start > end) return;
      const length = end - start + 1;
      if (length > 10000) return;

      const pipeline = redisClient.multi();
      for (let i = start; i <= end; i++) {
        pipeline.getBit(CHECKBOX_KEY, i);
      }
      const results = await pipeline.exec();
      socket.emit("server:response:range", { start, states: results });
    });

    socket.on("client:checkbox:change", async (data) => {
      const { index, checked } = data;

      const user = socket.request.session?.user;
      if (!user) {
        return socket.emit("server:error", {
          message: "Unauthorized. Please login to toggle checkboxes.",
        });
      }

      const isAllowed = await rateLimit(
        `ratelimit:socket:${user.sub || socket.id}`,
        10,
        1,
      );
      if (!isAllowed) {
        return socket.emit("server:error", { message: "Rate limit exceeded" });
      }

      if (index < 0 || index >= TOTAL_CHECKBOXES) return;

      await redisClient.setBit(CHECKBOX_KEY, index, checked ? 1 : 0);

      const updateData = { index, checked };
      pubClient.publish("checkbox:update", JSON.stringify(updateData));
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });
  });

  server.listen(PORT, () => {
    console.log(`Server is listening on http://localhost:${PORT}`);
  });
}

main().catch(console.error);
