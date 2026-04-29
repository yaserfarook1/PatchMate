import { Server as SocketIOServer } from "socket.io";
import { Server as HttpServer } from "http";
import { config } from "../config.js";

let io: SocketIOServer;

export function initSocketServer(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: config.FRONTEND_URL,
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    socket.on("join:job", (packageId: string) => {
      socket.join(`job:${packageId}`);
    });

    socket.on("join:radar", (tenantId: string) => {
      socket.join(`radar:${tenantId}`);
    });

    socket.on("disconnect", () => {});
  });

  return io;
}

export function getSocketServer(): SocketIOServer {
  if (!io) throw new Error("Socket server not initialized");
  return io;
}
