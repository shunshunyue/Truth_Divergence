import { NextResponse } from "next/server";
import { refillCaseCacheOnce } from "@/game/cache/caseCacheWorker";

export async function POST() {
  const result = await refillCaseCacheOnce();
  return NextResponse.json(result);
}
