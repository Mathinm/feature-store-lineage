const API_BASE_URL = process.env.REACT_APP_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

// Standard authenticated fetch wrapper
export async function apiRequest(endpoint, options = {}) {
  const token = localStorage.getItem("token");
  
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "An error occurred");
  }
  return data;
}

// B1 & B2: Login & Save Token
export async function loginUser(email, password) {
  const data = await apiRequest("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

  if (data.token) {
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
  }
  return data;
}

// Logout & Clear Token
export async function logoutUser() {
  try {
    await apiRequest("/api/auth/logout", { method: "POST" });
  } catch (err) {
    console.warn("Logout notification failed:", err.message);
  } finally {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  }
}
