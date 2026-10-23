export default function ProvenanceCard({ source, requestId, generatedAtUtc }: { source: string; requestId?: string; generatedAtUtc?: string }) {
  return <dl className="science-provenance"><div><dt>Fonte</dt><dd>{source}</dd></div>{generatedAtUtc && <div><dt>Gerado em</dt><dd>{generatedAtUtc}</dd></div>}{requestId && <div><dt>Request ID</dt><dd><code>{requestId}</code></dd></div>}</dl>;
}
