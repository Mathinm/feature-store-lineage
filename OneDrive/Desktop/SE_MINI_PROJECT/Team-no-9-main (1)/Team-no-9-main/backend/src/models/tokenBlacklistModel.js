import mongoose from "mongoose";

const tokenBlacklistSchema = new mongoose.Schema({
  token: { type: String, required: true, index: true },
  expiresAt: { type: Date, required: true, expires: 0 }
});

export default mongoose.model("TokenBlacklist", tokenBlacklistSchema);
