import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { buildApiKeyProviderList, buildOAuthProviderList } from "@/lib/provider-listing";
import { collectProviderListingInputs } from "@/lib/provider-listing-runtime";

export const dynamic = "force-dynamic";

/** Load both authentication lists from one ModelRuntime snapshot. */
export async function GET() {
  const modelRuntime = await ModelRuntime.create();
  const inputs = await collectProviderListingInputs(modelRuntime);
  return Response.json({
    oauth: buildOAuthProviderList(inputs),
    apiKey: buildApiKeyProviderList(inputs),
  });
}
