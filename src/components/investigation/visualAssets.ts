import type { CaseVisualManifest, VisualAsset, VisualAssetKind } from "@/game/schemas/visuals";

export function findVisualAsset(
  manifest: CaseVisualManifest | undefined,
  options: { kind?: VisualAssetKind; entityId?: string; assetId?: string },
): VisualAsset | undefined {
  if (!manifest) return undefined;
  return manifest.assets.find((asset) => {
    if (options.assetId && asset.id !== options.assetId) return false;
    if (options.kind && asset.kind !== options.kind) return false;
    if (options.entityId && asset.entityId !== options.entityId) return false;
    return asset.status === "pending" || Boolean(asset.fileUrl || asset.thumbUrl);
  });
}

export function visualUrl(asset: VisualAsset | undefined, preferThumb = false) {
  if (!asset) return undefined;
  return (preferThumb ? asset.thumbUrl || asset.fileUrl : asset.fileUrl || asset.thumbUrl) || undefined;
}
