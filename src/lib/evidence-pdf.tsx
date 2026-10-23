import React from 'react';
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import type { ReceiptView } from './proof-receipt';

export interface EvidencePdfInput {
  receipt: ReceiptView;
  status: 'approved' | 'edited';
  decidedAt: Date;
}

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 11, fontFamily: 'Helvetica' },
  heading: { fontSize: 18, marginBottom: 12, fontFamily: 'Helvetica-Bold' },
  sectionTitle: { fontSize: 13, marginTop: 16, marginBottom: 6, fontFamily: 'Helvetica-Bold' },
  meta: { marginBottom: 3, color: '#374151' },
  diffText: { lineHeight: 1.5 },
  checkLine: { marginBottom: 2 },
});

export async function renderEvidencePdf(input: EvidencePdfInput): Promise<Buffer> {
  const { receipt, status, decidedAt } = input;
  const snapshot = receipt.snapshot;
  const record = snapshot ?? receipt.currentRecord;
  const content = snapshot ? snapshot.decidedContent : receipt.currentRecord.draftContent;
  const metricsLabel = receipt.outcome.availability === 'observed_rows'
    ? 'Observed GSC rows'
    : receipt.outcome.availability === 'historical_unqualified'
      ? 'Historical values; row availability was not recorded'
      : 'GSC row availability unavailable';
  const isEdited = status === 'edited' || snapshot?.decision === 'edited';

  const doc = (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.heading}>Dex Evidence Pack</Text>
        <Text style={styles.meta}>{record.pageUrl}</Text>
        <Text style={styles.meta}>{status === 'approved' ? 'Approved' : 'Edited'} on {decidedAt.toLocaleDateString()}</Text>
        <Text style={styles.meta}>
          {receipt.basis === 'saved_snapshot' ? 'Saved when the decision was made' : 'No decision saved yet'}
        </Text>
        {snapshot && <Text style={styles.meta}>Decision recorded: {snapshot.decision} at {snapshot.decidedAt}</Text>}

        <Text style={styles.sectionTitle}>Checked content</Text>
        <Text style={styles.meta}>Checked-content association unavailable. The recorded checks do not establish which content was checked.</Text>
        {isEdited && <Text style={styles.meta}>Edited content was not rechecked.</Text>}

        {snapshot?.decision === 'edited' && (
          <>
            <Text style={styles.sectionTitle}>Original draft at decision</Text>
            <Text style={styles.diffText}>{snapshot.preDecisionDraftContent}</Text>
          </>
        )}
        <Text style={styles.sectionTitle}>{snapshot ? 'Decided content' : 'Current draft'}</Text>
        <Text style={styles.diffText}>{content}</Text>

        <Text style={styles.sectionTitle}>Recorded checks</Text>
        {record.guard ? (
          <View>
            <Text style={styles.meta}>{record.guard.outcome}: {record.guard.reasoning}</Text>
            {record.guard.checksRun.map((check, index) => (
              <Text key={`${check.check}-${index}`} style={styles.checkLine}>
                {check.check}: {check.result} - {check.detail}
              </Text>
            ))}
          </View>
        ) : (
          <Text style={styles.meta}>No recorded checks available.</Text>
        )}

        <Text style={styles.sectionTitle}>Search measurement</Text>
        <Text style={styles.meta}>{metricsLabel}</Text>
        {receipt.outcome.availability !== 'unavailable' && (
          <View>
            <Text style={styles.meta}>Baseline{receipt.outcome.baselineCapturedAt ? ` (${receipt.outcome.baselineCapturedAt})` : ''}</Text>
            <Text style={styles.diffText}>{JSON.stringify(receipt.outcome.baseline, null, 2)}</Text>
            <Text style={styles.meta}>Follow-up{receipt.outcome.measuredAt ? ` (${receipt.outcome.measuredAt})` : ''}</Text>
            <Text style={styles.diffText}>{JSON.stringify(receipt.outcome.measured, null, 2)}</Text>
          </View>
        )}

        {receipt.limitations.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>Limitations</Text>
            {receipt.limitations.map((limitation, index) => (
              <Text key={index} style={styles.checkLine}>{limitation}</Text>
            ))}
          </View>
        )}

        <Text style={styles.meta}>Decisions do not change your website. Apply approved changes manually.</Text>
      </Page>
    </Document>
  );

  return renderToBuffer(doc);
}
