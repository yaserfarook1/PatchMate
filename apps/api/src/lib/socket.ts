import { Server as SocketIOServer } from "socket.io";
import { Server as HttpServer } from "http";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

let io: SocketIOServer;

export function initSocketServer(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: config.FRONTEND_URL,
      methods: ["GET", "POST"],
    },
  });

  // Authenticate WebSocket connections via JWT
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error("Authentication required"));
    }
    try {
      jwt.verify(token, config.JWT_SECRET, { algorithms: ["HS256"] });
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("join:job", (packageId: string) => {
      socket.join(`job:${packageId}`);
    });
    socket.on("join:radar", (tenantId: string) => {
      socket.join(`radar:${tenantId}`);
    });
  });

  return io;
}

export function getSocketServer(): SocketIOServer {
  if (!io) throw new Error("Socket server not initialized");
  return io;
}
