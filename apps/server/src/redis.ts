import { Redis } from "ioredis"

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6380"

export const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
})

redis.on("connect", () => {
    console.log("[redis] connected")
})

redis.on("error", (err) => {
    console.error("[redis] error:", err.message)
})