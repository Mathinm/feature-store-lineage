import jwt from "jsonwebtoken";
import TokenBlacklist from "../models/tokenBlacklistModel.js";

const JWT_SECRET = process.env.JWT_SECRET || "wealth_mgmt_jwt_secret_key_2026";

export const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({ success: false, message: "Not authorized, token missing" });
  }

  try {
    const blacklisted = await TokenBlacklist.findOne({ token });
    if (blacklisted) {
      return res.status(401).json({ success: false, message: "Token revoked. Please login again." });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Session expired or invalid token" });
  }
};
