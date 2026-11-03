import User from "../models/userModel.js";
import Asset from "../models/assetModel.js";

export const ensurePerformanceIndexes = async () => {
  try {
    await User.collection.createIndex({ email: 1 }, { unique: true });
    await Asset.collection.createIndex({ userId: 1, assetType: 1 });
    await Asset.collection.createIndex({ userId: 1, createdAt: -1 });
    console.log("Indexes configured for high-concurrency 1000+ user scalability.");
  } catch (error) {
    console.error("Index initialization error:", error);
  }
};
