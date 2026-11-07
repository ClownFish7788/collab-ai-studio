import 'tldraw/tldraw.css'

export default function Layout({ children }: { children: React.ReactNode }) {
    return <html><body style={{ margin: 0, fontFamily: 'sans-serif' }}>{children}</body></html>
}
