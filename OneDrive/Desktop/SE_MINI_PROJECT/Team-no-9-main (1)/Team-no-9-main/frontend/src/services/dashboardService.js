import { apiRequest } from "./api";

// B11: Direct alignment with backend Sprint 2 endpoint
export async function fetchDashboardSummary() {
  return await apiRequest("/api/assets/dashboard-summary", {
    method: "GET",
  });
}
