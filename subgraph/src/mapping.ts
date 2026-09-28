import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  DatasetRegistered,
  RecordAdded,
  AttestationRevoked,
} from "../generated/EcoProvenanceRegistry/EcoProvenanceRegistry";
import {
  Dataset,
  ProvenanceRecord,
  ProvenanceEvent,
} from "../generated/schema";

const RECORD_TYPE_SOURCE = 0;
const RECORD_TYPE_TRANSFORMATION = 1;
const RECORD_TYPE_ATTESTATION = 2;

function recordTypeLabel(raw: i32): string {
  if (raw == RECORD_TYPE_SOURCE) return "SOURCE";
  if (raw == RECORD_TYPE_TRANSFORMATION) return "TRANSFORMATION";
  return "ATTESTATION";
}

export function handleDatasetRegistered(event: DatasetRegistered): void {
  let id = event.params.datasetId.toString();
  let dataset = new Dataset(id);

  dataset.datasetId = event.params.datasetId;
  dataset.owner = event.params.owner;
  dataset.name = event.params.name;
  dataset.category = event.params.category;
  dataset.createdAt = event.params.timestamp;
  dataset.createdAtBlock = event.block.number;
  dataset.txHash = event.transaction.hash;
  dataset.sourceCount = 0;
  dataset.transformationCount = 0;
  dataset.attestationCount = 0;
  dataset.save();

  let evt = new ProvenanceEvent(
    event.transaction.hash.toHex() + "-" + event.logIndex.toString()
  );
  evt.dataset = id;
  evt.record = null;
  evt.eventType = "DatasetRegistered";
  evt.actor = event.params.owner;
  evt.timestamp = event.params.timestamp;
  evt.blockNumber = event.block.number;
  evt.txHash = event.transaction.hash;
  evt.save();
}

export function handleRecordAdded(event: RecordAdded): void {
  let recordId = event.params.recordId.toString();
  let datasetId = event.params.datasetId.toString();

  let record = new ProvenanceRecord(recordId);
  record.recordId = event.params.recordId;
  record.dataset = datasetId;
  record.recordType = recordTypeLabel(event.params.recordType);
  record.submitter = event.params.submitter;
  record.contentHash = event.params.contentHash;
  record.uri = event.params.uri;
  record.method = event.params.method;

  // refIds: array of parent record ids (empty for Source, inputs for
  // Transformation, single target for Attestation).
  let refIds: BigInt[] = event.params.refIds;
  let refIdStrings: BigInt[] = [];
  let refs: string[] = [];
  for (let i = 0; i < refIds.length; i++) {
    refIdStrings.push(refIds[i]);
    refs.push(refIds[i].toString());
  }
  record.refIds = refIdStrings;
  record.refs = refs;

  if (event.params.supersedes.notEqual(BigInt.zero())) {
    record.supersedes = event.params.supersedes.toString();
  }

  record.revoked = false;
  record.timestamp = event.params.timestamp;
  record.blockNumber = event.block.number;
  record.txHash = event.transaction.hash;
  record.save();

  // Keep per-dataset counters up to date for quick dashboard queries.
  let dataset = Dataset.load(datasetId);
  if (dataset != null) {
    if (event.params.recordType == RECORD_TYPE_SOURCE) {
      dataset.sourceCount = dataset.sourceCount + 1;
    } else if (event.params.recordType == RECORD_TYPE_TRANSFORMATION) {
      dataset.transformationCount = dataset.transformationCount + 1;
    } else {
      dataset.attestationCount = dataset.attestationCount + 1;
    }
    dataset.save();
  }

  let evt = new ProvenanceEvent(
    event.transaction.hash.toHex() + "-" + event.logIndex.toString()
  );
  evt.dataset = datasetId;
  evt.record = recordId;
  evt.eventType = "RecordAdded";
  evt.actor = event.params.submitter;
  evt.timestamp = event.params.timestamp;
  evt.blockNumber = event.block.number;
  evt.txHash = event.transaction.hash;
  evt.save();
}

export function handleAttestationRevoked(event: AttestationRevoked): void {
  let recordId = event.params.recordId.toString();
  let record = ProvenanceRecord.load(recordId);
  if (record == null) {
    return; // defensive: should never happen if events arrive in order
  }

  record.revoked = true;
  record.revokedReason = event.params.reason;
  record.revokedBy = event.params.revoker;
  record.revokedAt = event.params.timestamp;
  record.save();

  let evt = new ProvenanceEvent(
    event.transaction.hash.toHex() + "-" + event.logIndex.toString()
  );
  evt.dataset = record.dataset;
  evt.record = recordId;
  evt.eventType = "AttestationRevoked";
  evt.actor = event.params.revoker;
  evt.timestamp = event.params.timestamp;
  evt.blockNumber = event.block.number;
  evt.txHash = event.transaction.hash;
  evt.save();
}
