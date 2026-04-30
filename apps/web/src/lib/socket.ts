import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io("/", {
      autoConnect: true,
      transports: ["websocket", "polling"],
      auth: {
        token: localStorage.getItem("autopack_token") ?? "",
      },
    });
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
