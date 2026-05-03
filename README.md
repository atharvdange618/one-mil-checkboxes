# 1 Million Checkboxes - Real-Time Scalable System

A high-performance, real-time web application allowing users to interact with a grid of 1 million checkboxes simultaneously. Built with a focus on scalability, memory efficiency, and robust security.

## Key Features & Architectural Decisions

This project is designed to handle **scale** and **concurrency** by leveraging industry-standard patterns:

### 1. High-Performance State Storage (Redis Bitmaps)

- **The Challenge**: Storing 1,000,000 boolean states in a traditional database would be slow and storage-heavy.
- **The Solution**: Used **Redis Bitmaps** (`SETBIT`, `GETBIT`).
- **Efficiency**: The entire state of 1 million checkboxes occupies only **~125 KB** of memory, allowing for O(1) time complexity updates and fetches.

### 2. Real-Time Synchronization (Redis Pub/Sub + WebSockets)

- **Pub/Sub Architecture**: When a checkbox is toggled, the event is published to a Redis channel. All backend instances subscribed to this channel then broadcast the change to their connected clients via Socket.io.
- **Horizontal Scalability**: This ensures that even if users are connected to different server instances (in a load-balanced environment), everyone sees updates in real-time.

### 3. Custom Rate Limiting (Abuse Prevention)

- **No External Packages**: Implemented from scratch using Redis.
- **Mechanism**: Uses a **Sliding Window** counter with Redis `INCR` and `EXPIRE`.
- **WebSocket Protection**: Specifically limits the `client:checkbox:change` event to **10 toggles per second per user**, preventing spam-click scripts.

### 4. OIDC / OAuth 2.0 Authentication

- **Secure Access**: Integrated with **Kleis IdP** using the **Authorization Code Flow with PKCE**.
- **Role-Based Interaction**:
  - **Anonymous**: Read-only access (receives real-time updates).
  - **Authenticated**: Full interaction (can toggle checkboxes).
- **Socket Security**: The Express session is shared with Socket.io, allowing the server to verify the user's identity before processing any state changes.

### 5. Frontend Virtualization

- **DOM Performance**: Rendering 1,000,000 `<input>` tags would freeze the browser.
- **Virtual Grid**: Implemented a custom virtualizer that calculates the viewport and renders only the visible checkboxes (~500 items). As the user scrolls, the grid updates dynamically, maintaining 60 FPS performance.

---

## Tech Stack

- **Backend**: Node.js, Express
- **Real-Time**: Socket.io
- **Database/Coordination**: Redis
- **Auth**: OIDC / OAuth 2.0 (Kleis IdP)
- **Frontend**: Vanilla JS, CSS (Grid/Flexbox)

---

## Setup Instructions

1. **Clone the repository**

- Kleis IDP:

```bash
  git clone https://github.com/atharvdange618/OIDC
  cd apps/idp
  pnpm install
  pnpm run dev
```

- One million checkboxes

```bash
git clone https://github.com/atharvdange618/one-mil-checkboxes
```

2. **Install Dependencies**:
   ```bash
   pnpm install
   ```
3. **Configure Environment**:
   - Copy `.env.example` to `.env`.
   - Ensure `REDIS_URL` points to your running Redis instance.
   - Ensure `IDP_URL` points to your Kleis IdP (default `http://localhost:4000`).
4. **Start the Application**:
   ```bash
   pnpm start
   ```
5. **Access the App**: Open `http://localhost:8000`.

---

## Demo

- **YouTube Link**: yet to come bois
- **Includes**: Real-time sync demo, Auth flow, Rate limiting trigger, and 1M scroll performance.
