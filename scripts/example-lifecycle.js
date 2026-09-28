// Walks through a full provenance lifecycle against a deployed registry:
// register a dataset -> add a source -> add a transformation -> attest to it
// -> correct the transformation. Run with:
//   npx hardhat run scripts/example-lifecycle.js --network baseSepolia
const hre = require("hardhat");

async function main() {
  const registryAddress = process.env.REGISTRY_ADDRESS;
  if (!registryAddress) throw new Error("Set REGISTRY_ADDRESS env var");

  const registry = await hre.ethers.getContractAt("EcoProvenanceRegistry", registryAddress);
  const hash = (s) => hre.ethers.keccak256(hre.ethers.toUtf8Bytes(s));

  let tx = await registry.registerDataset("Mekong Delta Mangrove Cover", "biodiversity");
  let receipt = await tx.wait();
  const datasetId = receipt.logs[0].args.datasetId;
  console.log("Dataset:", datasetId.toString());

  tx = await registry.addSource(
    datasetId,
    hash("sentinel-2-scene-2026-09-01.tif"),
    "ipfs://bafy.../sentinel-2-scene-2026-09-01.tif",
    "Sentinel-2-L2A"
  );
  receipt = await tx.wait();
  const sourceId = receipt.logs[0].args.recordId;
  console.log("Source record:", sourceId.toString());

  tx = await registry.addTransformation(
    datasetId,
    hash("ndvi-mangrove-mask-v1.geojson"),
    "ipfs://bafy.../ndvi-mangrove-mask-v1.geojson",
    "NDVI-threshold-classification-v1",
    [sourceId]
  );
  receipt = await tx.wait();
  const transformId = receipt.logs[0].args.recordId;
  console.log("Transformation record:", transformId.toString());

  tx = await registry.attest(
    datasetId,
    transformId,
    hash("audit-report-2026-09-05.pdf"),
    "ipfs://bafy.../audit-report-2026-09-05.pdf",
    "third-party-remote-sensing-audit"
  );
  receipt = await tx.wait();
  console.log("Attestation record:", receipt.logs[0].args.recordId.toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
