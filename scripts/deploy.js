const hre = require("hardhat");

async function main() {
  const Registry = await hre.ethers.getContractFactory("EcoProvenanceRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  const deployTx = registry.deploymentTransaction();
  const receipt = await deployTx.wait();

  console.log("EcoProvenanceRegistry deployed to:", address);
  console.log("Deployment block:", receipt.blockNumber);
  console.log("\nNext steps:");
  console.log(`1. Set 'address' to ${address} in subgraph/subgraph.yaml`);
  console.log(`2. Set 'startBlock' to ${receipt.blockNumber} in subgraph/subgraph.yaml`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
