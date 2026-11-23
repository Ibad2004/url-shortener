import mongoose from "mongoose";
import { createApp } from "./app.js";
import { Link } from "./link.model.js";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is not set. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

try {
  await mongoose.connect(uri, { dbName: "url-shortener", serverSelectionTimeoutMS: 10000 });
  await Link.init();
} catch {
  console.error("Could not connect to MongoDB. Check MONGODB_URI and your Atlas network access.");
  process.exit(1);
}

const port = Number(process.env.PORT ?? 5000);
createApp().listen(port, () => {
  console.log(`Listening on port ${port}`);
});
