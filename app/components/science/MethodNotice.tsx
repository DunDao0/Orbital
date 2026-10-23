export default function MethodNotice({ method, limitations = [] }: { method: string; limitations?: string[] }) {
  return <aside className="science-method"><strong>Método</strong><p>{method}</p>{limitations.length > 0 && <ul>{limitations.map((item) => <li key={item}>{item}</li>)}</ul>}</aside>;
}
