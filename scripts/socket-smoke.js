import { io } from "socket.io-client";

const socket = io("http://localhost:3000", {
  auth: { userId: "a0000000-0000-0000-0000-000000000000" }, // must be UUID
  transports: ["websocket"],
});

socket.on("connect", () => {
  console.log("connected", socket.id);
  socket.emit("chat:send", { message: "Ok"});
});

socket.on("chat:chunk", (data) => console.log("chunk:", data));
socket.on("chat:complete", (data) => {
  console.log("complete:", data);
  socket.disconnect();
});

socket.on("chat:error", (err) => console.log("error:", err));
socket.on("connect_error", (err) => console.log("connect_error:", err.message));