import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  getExtensionToolsPath,
  readExtensionToolSettings,
  writeExtensionToolSettings,
} from "@/lib/extension-tools";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  try {
    const settings = readExtensionToolSettings();
    return NextResponse.json({
      disabled: settings.disabled,
      filePath: getExtensionToolsPath(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as { disabled?: unknown };
    if (!Array.isArray(body.disabled) || body.disabled.some((name) => typeof name !== "string")) {
      return NextResponse.json({ error: "disabled must be an array of tool names" }, { status: 400 });
    }
    const settings = await writeExtensionToolSettings({ disabled: body.disabled as string[] });
    return NextResponse.json({ disabled: settings.disabled, filePath: getExtensionToolsPath() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
