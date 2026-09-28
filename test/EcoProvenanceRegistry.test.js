const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EcoProvenanceRegistry", function () {
  async function deploy() {
    const [owner, other] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("EcoProvenanceRegistry");
    const registry = await Registry.deploy();
    await registry.waitForDeployment();
    return { registry, owner, other };
  }

  const hash = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));

  it("registers a dataset", async function () {
    const { registry, owner } = await deploy();
    const tx = await registry.registerDataset("Reef Health Index", "coral-reef");
    const receipt = await tx.wait();
    const datasetId = receipt.logs[0].args.datasetId;

    expect(datasetId).to.equal(1n);
    const dataset = await registry.datasets(datasetId);
    expect(dataset.owner).to.equal(owner.address);
    expect(dataset.name).to.equal("Reef Health Index");
  });

  it("records a source and a downstream transformation", async function () {
    const { registry } = await deploy();
    await registry.registerDataset("Reef Health Index", "coral-reef");

    let tx = await registry.addSource(1, hash("survey-1"), "ipfs://a", "diver-survey");
    let receipt = await tx.wait();
    const sourceId = receipt.logs[0].args.recordId;
    expect(sourceId).to.equal(1n);

    tx = await registry.addTransformation(1, hash("cleaned-1"), "ipfs://b", "outlier-removal", [sourceId]);
    receipt = await tx.wait();
    const transformId = receipt.logs[0].args.recordId;

    const record = await registry.getRecord(transformId);
    expect(record.recordType).to.equal(1); // Transformation
    expect(record.refIds.map(Number)).to.deep.equal([Number(sourceId)]);
  });

  it("rejects a transformation with no inputs", async function () {
    const { registry } = await deploy();
    await registry.registerDataset("Reef Health Index", "coral-reef");
    await expect(
      registry.addTransformation(1, hash("x"), "ipfs://x", "method", [])
    ).to.be.revertedWith("transformation needs >=1 input");
  });

  it("rejects records referencing another dataset", async function () {
    const { registry } = await deploy();
    await registry.registerDataset("Dataset A", "cat-a");
    await registry.registerDataset("Dataset B", "cat-b");

    const tx = await registry.addSource(1, hash("s1"), "ipfs://a", "method");
    const receipt = await tx.wait();
    const sourceId = receipt.logs[0].args.recordId;

    await expect(
      registry.addTransformation(2, hash("t1"), "ipfs://b", "method", [sourceId])
    ).to.be.revertedWith("referenced record belongs to a different dataset");
  });

  it("attests to a record and allows only the attester to revoke", async function () {
    const { registry, other } = await deploy();
    await registry.registerDataset("Reef Health Index", "coral-reef");
    let tx = await registry.addSource(1, hash("s1"), "ipfs://a", "method");
    let receipt = await tx.wait();
    const sourceId = receipt.logs[0].args.recordId;

    tx = await registry.attest(1, sourceId, hash("audit"), "ipfs://c", "third-party-audit");
    receipt = await tx.wait();
    const attestationId = receipt.logs[0].args.recordId;

    await expect(
      registry.connect(other).revokeAttestation(attestationId, "conflict of interest")
    ).to.be.revertedWith("only original attester can revoke");

    await expect(registry.revokeAttestation(attestationId, "superseded by newer audit"))
      .to.emit(registry, "AttestationRevoked");
  });

  it("chains corrections via supersedes without deleting history", async function () {
    const { registry } = await deploy();
    await registry.registerDataset("Reef Health Index", "coral-reef");
    let tx = await registry.addSource(1, hash("s1"), "ipfs://a", "method");
    let receipt = await tx.wait();
    const sourceId = receipt.logs[0].args.recordId;

    tx = await registry.correctRecord(1, sourceId, hash("s1-fixed"), "ipfs://a-fixed", "method", []);
    receipt = await tx.wait();
    const correctedId = receipt.logs[0].args.recordId;

    const original = await registry.getRecord(sourceId);
    const corrected = await registry.getRecord(correctedId);
    expect(original.timestamp).to.not.equal(0n); // still readable, never deleted
    expect(corrected.supersedes).to.equal(sourceId);
  });
});
