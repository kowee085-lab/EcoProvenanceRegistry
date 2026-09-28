# Eco Provenance Registry

On-chain provenance registry for ecological datasets. Records **where data
came from** (sources), **what was done to it** (transformations), and **who
vouches for it** (attestations), with a subgraph that indexes the full
lineage graph for querying.

## Why

Ecological datasets (satellite imagery, sensor feeds, field surveys, derived
indices) pass through many hands and processing steps before they're used to
justify carbon credits, conservation funding, or policy. Most of that chain
is undocumented or lives in a PDF nobody can verify. This registry makes the
chain itself the verifiable artifact: every source, every transformation,
and every attestation is a signed, timestamped, immutable on-chain record.

## Architecture

```
contracts/EcoProvenanceRegistry.sol   Solidity contract — source of truth
subgraph/                             The Graph subgraph — queryable index
  schema.graphql                      Entities: Dataset, ProvenanceRecord, ProvenanceEvent
  subgraph.yaml                       Manifest — event handler wiring
  src/mapping.ts                      Event -> entity mapping logic
scripts/deploy.js                     Deploy the contract
scripts/example-lifecycle.js          End-to-end example: register -> source -> transform -> attest
test/EcoProvenanceRegistry.test.js    Hardhat unit tests
```

### Data model

Every source, transformation, and attestation is a `Record` with the same
shape, distinguished by `recordType`:

| Field | Meaning |
|---|---|
| `datasetId` | which dataset this belongs to |
| `contentHash` | keccak256 hash of the off-chain payload (verifiable against the file at `uri`) |
| `uri` | `ipfs://`, `ar://`, or `https://` pointer to the actual data |
| `method` | free-text label — sensor/model name, transform algorithm, or attestation standard |
| `refIds` | parent record ids: empty for a `Source`, input record(s) for a `Transformation`, the target record for an `Attestation` |
| `supersedes` | if nonzero, this record is a correction of an earlier one — the old record is never deleted |

This keeps the graph simple: a **Source** has no parents, a
**Transformation** consumes one or more prior records, and an
**Attestation** points at exactly one record it's vouching for.
Attestations can themselves be attested or corrected, since they're
records like any other.

Content lives off-chain (IPFS/Arweave/HTTP) — only the hash and pointer are
on-chain, so gas stays low regardless of dataset size, while the hash lets
anyone verify the off-chain payload hasn't been swapped.

### Access model

Writing is **permissionless**: anyone can register a dataset or submit a
record. There's no on-chain gatekeeping of data quality — that's what
attestations are for. Every record is bound to `msg.sender`, so low-quality
or bad-faith submitters are identifiable and can be filtered out
off-chain (e.g. in a subgraph query or a reputation layer built on top)
without needing on-chain permissioning that would just recreate a
centralized gatekeeper.

## Setup

```bash
npm install
cp .env.example .env   # fill in an RPC URL and deployer key
```

### Compile & test

```bash
npm run compile
npm test
```

### Deploy

```bash
npm run deploy:base-sepolia   # testnet first
npm run deploy:base           # then mainnet
```

The deploy script prints the deployed address and block number — put both
into `subgraph/subgraph.yaml` (`source.address` and `source.startBlock`).

### Run the example lifecycle

```bash
REGISTRY_ADDRESS=0xYourDeployedAddress npx hardhat run scripts/example-lifecycle.js --network baseSepolia
```

Walks through: register a dataset → add a satellite-imagery source → add an
NDVI classification transformation derived from it → attach a third-party
audit attestation to the transformation.

### Subgraph

```bash
cd subgraph
npm install
npm run codegen   # generates AssemblyScript types from schema.graphql + ABI
npm run build
npm run deploy    # push to Graph Studio / hosted node of your choice
```

Example query — full lineage of a dataset, newest first:

```graphql
{
  dataset(id: "1") {
    name
    category
    sourceCount
    transformationCount
    attestationCount
    records(orderBy: timestamp, orderDirection: desc) {
      recordType
      method
      uri
      submitter
      refs { id recordType }
      supersedes { id }
      revoked
      timestamp
    }
  }
}
```

Trace a single transformation back to its raw sources:

```graphql
{
  provenanceRecord(id: "2") {
    recordType
    method
    refs {
      recordType
      uri
      method
      submitter
    }
  }
}
```

## Design notes / trade-offs

- **No deletion, ever.** Corrections are new records linked via
  `supersedes`, so a dataset's full history — including superseded and
  revoked entries — stays auditable. This is deliberate for an ecological
  provenance registry: silently editable history defeats the purpose.
- **`uint64` ids/timestamps** instead of `uint256` to keep storage slots
  tight (packs with `address`/`bool` fields) — ecological registries don't
  need 256-bit id space, and this measurably lowers gas per record.
- **No `Ownable`/access control on writes.** Considered gating
  `addSource`/`addTransformation` to registered "trusted" submitters, but
  that reintroduces a centralized gatekeeper, which is exactly what
  attestations are meant to replace. Reputation/filtering is left to
  consumers of the subgraph.
- **Flat `ProvenanceEvent` log** in the subgraph in addition to the
  structured entities — makes it trivial to render a timeline or diff the
  indexer's output against raw chain events during audits.

## License

MIT
