// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title EcoProvenanceRegistry
/// @notice On-chain provenance registry for ecological datasets: records data
///         sources, transformation steps, and third-party attestations so any
///         downstream consumer can reconstruct a dataset's full lineage.
/// @dev Design goals:
///      - Permissionless write access, but every write is bound to msg.sender
///        so bad-faith submitters are cheaply identifiable and filterable off-chain.
///      - No mutation or deletion of history. Corrections are new records that
///        reference the record they supersede (supersedes != 0).
///      - Content itself lives off-chain (IPFS/Arweave/HTTP); only a content
///        hash + URI is stored on-chain to keep gas low while keeping the
///        hash verifiable against the off-chain payload.
///      - Flat event log + minimal on-chain state, so a subgraph/indexer does
///        the heavy lifting for queries (full history, graphs, filters).
contract EcoProvenanceRegistry {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum RecordType {
        Source,          // 0 - raw data ingested from an origin
        Transformation,  // 1 - a processing step applied to prior record(s)
        Attestation      // 2 - a claim about the validity/quality of a record
    }

    struct Dataset {
        uint64 id;
        address owner;
        string name;          // human-readable dataset name
        string category;      // e.g. "biodiversity", "carbon", "water-quality"
        uint64 createdAt;
        bool exists;
    }

    // A single provenance record. Sources, transformations and attestations
    // all share this shape; `recordType` and the semantics of `refIds`
    // disambiguate them:
    //   - Source:         refIds is empty (no on-chain parent)
    //   - Transformation: refIds lists the input record id(s) it consumed
    //   - Attestation:    refIds lists the single record id being attested
    struct Record {
        uint64 id;
        uint64 datasetId;
        RecordType recordType;
        address submitter;
        bytes32 contentHash;   // keccak256 / sha256 of the off-chain payload
        string uri;            // ipfs://, ar://, or https:// pointer to payload
        string method;         // free-text: source method, transform algo, or attestation standard
        uint64[] refIds;       // parent record id(s), see semantics above
        uint64 supersedes;     // 0 if this is not a correction of a prior record
        uint64 timestamp;
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    uint64 private _nextDatasetId = 1;
    uint64 private _nextRecordId = 1;

    mapping(uint64 => Dataset) public datasets;
    mapping(uint64 => Record) public records;
    mapping(uint64 => uint64[]) public datasetRecordIds; // datasetId => record ids, in submission order

    // ---------------------------------------------------------------------
    // Events (subgraph indexes off these; storage above is for on-chain reads)
    // ---------------------------------------------------------------------

    event DatasetRegistered(
        uint64 indexed datasetId,
        address indexed owner,
        string name,
        string category,
        uint64 timestamp
    );

    event RecordAdded(
        uint64 indexed recordId,
        uint64 indexed datasetId,
        RecordType indexed recordType,
        address submitter,
        bytes32 contentHash,
        string uri,
        string method,
        uint64[] refIds,
        uint64 supersedes,
        uint64 timestamp
    );

    event AttestationRevoked(
        uint64 indexed recordId,
        address indexed revoker,
        string reason,
        uint64 timestamp
    );

    // ---------------------------------------------------------------------
    // Dataset lifecycle
    // ---------------------------------------------------------------------

    /// @notice Register a new ecological dataset. Anyone can register one;
    ///         the caller becomes its owner (owner has no special write
    ///         powers over records — it's metadata for UI/attribution only).
    function registerDataset(string calldata name, string calldata category)
        external
        returns (uint64 datasetId)
    {
        datasetId = _nextDatasetId++;
        datasets[datasetId] = Dataset({
            id: datasetId,
            owner: msg.sender,
            name: name,
            category: category,
            createdAt: uint64(block.timestamp),
            exists: true
        });

        emit DatasetRegistered(datasetId, msg.sender, name, category, uint64(block.timestamp));
    }

    // ---------------------------------------------------------------------
    // Record submission
    // ---------------------------------------------------------------------

    /// @notice Record a raw data source for a dataset (e.g. a sensor feed
    ///         export, satellite imagery batch, or field survey upload).
    function addSource(
        uint64 datasetId,
        bytes32 contentHash,
        string calldata uri,
        string calldata method // e.g. "IoT-sensor", "Landsat-9", "manual-survey"
    ) external returns (uint64 recordId) {
        _requireDataset(datasetId);
        uint64[] memory empty = new uint64[](0);
        recordId = _addRecord(datasetId, RecordType.Source, contentHash, uri, method, empty, 0);
    }

    /// @notice Record a transformation applied to one or more prior records
    ///         (a source, another transformation, or several inputs merged).
    function addTransformation(
        uint64 datasetId,
        bytes32 contentHash,
        string calldata uri,
        string calldata method, // e.g. "outlier-removal-v2", "unit-normalization"
        uint64[] calldata inputRecordIds
    ) external returns (uint64 recordId) {
        _requireDataset(datasetId);
        require(inputRecordIds.length > 0, "transformation needs >=1 input");
        for (uint256 i = 0; i < inputRecordIds.length; i++) {
            _requireRecordInDataset(inputRecordIds[i], datasetId);
        }
        recordId = _addRecord(datasetId, RecordType.Transformation, contentHash, uri, method, inputRecordIds, 0);
    }

    /// @notice Attest to the validity/quality of an existing record (source
    ///         or transformation). Attestations are themselves records, so
    ///         they can be attested/superseded like anything else.
    function attest(
        uint64 datasetId,
        uint64 targetRecordId,
        bytes32 contentHash,
        string calldata uri,
        string calldata method // e.g. "third-party-audit", "peer-review", "lab-QA"
    ) external returns (uint64 recordId) {
        _requireDataset(datasetId);
        _requireRecordInDataset(targetRecordId, datasetId);
        uint64[] memory refs = new uint64[](1);
        refs[0] = targetRecordId;
        recordId = _addRecord(datasetId, RecordType.Attestation, contentHash, uri, method, refs, 0);
    }

    /// @notice Submit a corrected version of an existing record. The new
    ///         record stands alongside the old one (history is never
    ///         deleted) but points back via `supersedes`.
    function correctRecord(
        uint64 datasetId,
