export default function HomePage() {
  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-8">
      <div className="w-full max-w-xs flex flex-col items-center gap-8">

        <div className="flex flex-col items-center gap-6 text-center">
          <h1 className="text-6xl font-semibold tracking-tight">
            File<span className="text-blue-400">drop</span>
          </h1>
          <p className="text-gray-400 text-m leading-relaxed w-xl">
            Fast, private file transfers direct between browsers. <br/>No account needed.
          </p>
        </div>

        <div className="w-full flex flex-col gap-2 text-sm text-gray-500">
          <div className="flex items-center gap-3 bg-gray-900 rounded-lg px-4 py-3">
            <span>⚡</span><span>Direct P2P when possible</span>
          </div>
          <div className="flex items-center gap-3 bg-gray-900 rounded-lg px-4 py-3">
            <span>☁️</span><span>Cloud fallback, always reliable</span>
          </div>
          <div className="flex items-center gap-3 bg-gray-900 rounded-lg px-4 py-3">
            <span>🔄</span><span>Resumable if connection drops</span>
          </div>
          <div className="flex items-center gap-3 bg-gray-900 rounded-lg px-4 py-3">
            <span>🔒</span><span>No login, no storage</span>
          </div>
        </div>

        <div className="w-full flex flex-col gap-3">
          <a
            href="/send"
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-colors text-sm"
          >
            📤 Send files
          </a>

          <a
            href="/receive"
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded-lg font-medium transition-colors text-sm"
          >
            📥 Receive files
          </a>
        </div>

      </div >
    </main >
  )
}