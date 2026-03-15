export default function HomePage() {
  return (
    <main className="flex flex-col items-center justify-center min-h-screen gap-8 p-8">
      <h1 className="text-4xl font-bold tracking-tight">FileDrop</h1>

      <p className="text-gray-400 text-lg">
        Fast, private file transfers — direct between browsers.
      </p>

      <div className="flex gap-4">
        <a
          href="/send"
          className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-colors"
        >
          Send a file
        </a>

        <a
          href="/receive"
          className="px-6 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg font-medium transition-colors"
        >
          Receive a file
        </a>
      </div>
    </main>
  )
}