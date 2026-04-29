import axios from "axios";

export const api = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("autopack_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const mockRole = localStorage.getItem("autopack_mock_role") ?? "Admin";
  config.headers["X-Mock-Role"] = mockRole;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("autopack_token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);
