"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function ArchitecturePage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-blue-600 mb-10"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Home
        </Link>

        <div className="flex justify-center overflow-x-auto">
          <svg width={720} height={820} viewBox="0 0 720 820" className="max-w-full" style={{ fontFamily: "'Courier New', Courier, monospace" }}>
            {/* Title */}
            <text x={20} y={30} fontSize={18} fontStyle="italic" fill="#000">Architecture Overview</text>

            {/* ── Layer 0: Traefik ── */}
            <rect x={260} y={55} width={200} height={50} fill="#fff" stroke="#000" strokeWidth={1.5} />
            <text x={360} y={76} textAnchor="middle" fontSize={13} fill="#000">Traefik Ingress</text>
            <text x={360} y={93} textAnchor="middle" fontSize={11} fill="#000">(TLS termination)</text>

            {/* Lines from Traefik to 3 services */}
            <line x1={360} y1={105} x2={360} y2={125} stroke="#000" strokeWidth={1.5} />
            <line x1={110} y1={125} x2={610} y2={125} stroke="#000" strokeWidth={1.5} />
            <line x1={110} y1={125} x2={110} y2={145} stroke="#000" strokeWidth={1.5} />
            <line x1={360} y1={125} x2={360} y2={145} stroke="#000" strokeWidth={1.5} />
            <line x1={610} y1={125} x2={610} y2={145} stroke="#000" strokeWidth={1.5} />

            {/* ── Layer 1: Three services ── */}
            <rect x={30} y={145} width={160} height={60} fill="#fff" stroke="#000" strokeWidth={1.5} />
            <text x={110} y={168} textAnchor="middle" fontSize={13} fill="#000">Frontend</text>
            <text x={110} y={183} textAnchor="middle" fontSize={10} fill="#000">Next.js SSR</text>
            <text x={110} y={197} textAnchor="middle" fontSize={10} fill="#000">Port 3000</text>

            <rect x={270} y={145} width={180} height={60} fill="#fff" stroke="#000" strokeWidth={1.5} />
            <text x={360} y={168} textAnchor="middle" fontSize={13} fill="#000">Go Gateway</text>
            <text x={360} y={183} textAnchor="middle" fontSize={10} fill="#000">(Gin)</text>
            <text x={360} y={197} textAnchor="middle" fontSize={10} fill="#000">Port 8080</text>

            <rect x={530} y={145} width={160} height={60} fill="#fff" stroke="#000" strokeWidth={1.5} />
            <text x={610} y={168} textAnchor="middle" fontSize={13} fill="#000">AI Service</text>
            <text x={610} y={183} textAnchor="middle" fontSize={10} fill="#000">(FastAPI)</text>
            <text x={610} y={197} textAnchor="middle" fontSize={10} fill="#000">Port 8000</text>

            {/* Arrow from Gateway to AI */}
            <line x1={450} y1={175} x2={530} y2={175} stroke="#000" strokeWidth={1.5} />
            <polygon points="526,171 526,179 534,175" fill="#000" />
            <text x={490} y={168} textAnchor="middle" fill="#666" fontSize={9}>proxy</text>

            {/* ── Layer 2: Gateway handlers (left side) ── */}
            <line x1={360} y1={205} x2={360} y2={240} stroke="#000" strokeWidth={1.5} />

            <rect x={70} y={240} rx={4} width={400} height={200} fill="#fff" stroke="#000" strokeWidth={1} strokeDasharray="6 3" />
            <text x={270} y={260} textAnchor="middle" fill="#000" fontSize={12} fontWeight="bold">Go Gateway Handlers</text>

            {/* Row 1 */}
            <rect x={85} y={275} width={120} height={36} fill="#fff" stroke="#000" strokeWidth={1} />
            <text x={145} y={291} textAnchor="middle" fontSize={10} fill="#000">/api/requisitions</text>
            <text x={145} y={303} textAnchor="middle" fontSize={8} fill="#666">CRUD + search</text>

            <rect x={215} y={275} width={120} height={36} fill="#fff" stroke="#000" strokeWidth={1} />
            <text x={275} y={291} textAnchor="middle" fontSize={10} fill="#000">/api/notifications</text>
            <text x={275} y={303} textAnchor="middle" fontSize={8} fill="#666">list + mark read</text>

            <rect x={345} y={275} width={110} height={36} fill="#fff" stroke="#000" strokeWidth={1} />
            <text x={400} y={291} textAnchor="middle" fontSize={10} fill="#000">/api/changes</text>
            <text x={400} y={303} textAnchor="middle" fontSize={8} fill="#666">audit log</text>

            {/* Row 2 */}
            <rect x={85} y={320} width={120} height={36} fill="#fff" stroke="#000" strokeWidth={1} />
            <text x={145} y={336} textAnchor="middle" fontSize={10} fill="#000">/api/stats</text>
            <text x={145} y={348} textAnchor="middle" fontSize={8} fill="#666">aggregations</text>

            <rect x={215} y={320} width={120} height={36} fill="#fff" stroke="#000" strokeWidth={1} />
            <text x={275} y={336} textAnchor="middle" fontSize={10} fill="#000">/api/managers</text>
            <text x={275} y={348} textAnchor="middle" fontSize={8} fill="#666">config + counts</text>

            <rect x={345} y={320} width={110} height={36} fill="#fff" stroke="#000" strokeWidth={1} />
            <text x={400} y={336} textAnchor="middle" fontSize={10} fill="#000">/api/upload</text>
            <text x={400} y={348} textAnchor="middle" fontSize={8} fill="#666">CSV import</text>

            {/* Row 3: WebSocket */}
            <rect x={130} y={368} width={280} height={36} fill="#fff" stroke="#000" strokeWidth={1} />
            <text x={270} y={383} textAnchor="middle" fontSize={10} fill="#000">/ws/notifications</text>
            <text x={270} y={396} textAnchor="middle" fontSize={8} fill="#666">WebSocket real-time push per manager</text>

            {/* ── Layer 2: AI agents (right side, separate) ── */}
            <line x1={610} y1={205} x2={610} y2={240} stroke="#000" strokeWidth={1.5} />

            <rect x={530} y={240} rx={4} width={170} height={200} fill="#fff" stroke="#000" strokeWidth={1} strokeDasharray="6 3" />
            <text x={615} y={260} textAnchor="middle" fill="#000" fontSize={11} fontWeight="bold">AI Assistants</text>

            <rect x={542} y={275} width={146} height={30} fill="#fff" stroke="#000" strokeWidth={1} />
            <text x={615} y={294} textAnchor="middle" fontSize={10} fill="#000">Change Summarizer</text>

            <rect x={542} y={312} width={146} height={30} fill="#fff" stroke="#000" strokeWidth={1} />
            <text x={615} y={331} textAnchor="middle" fontSize={10} fill="#000">Unusual Pattern Finder</text>

            <rect x={542} y={349} width={146} height={30} fill="#fff" stroke="#000" strokeWidth={1} />
            <text x={615} y={368} textAnchor="middle" fontSize={10} fill="#000">Q&A Chat Assistant</text>

            <rect x={542} y={386} width={146} height={30} fill="#fff" stroke="#000" strokeWidth={1} />
            <text x={615} y={405} textAnchor="middle" fontSize={10} fill="#000">Market Rate Collector</text>

            {/* ── Middleware (left) ── */}
            <line x1={110} y1={205} x2={110} y2={480} stroke="#000" strokeWidth={1.5} />

            <rect x={20} y={480} width={160} height={100} fill="#fff" stroke="#000" strokeWidth={1} strokeDasharray="6 3" />
            <text x={100} y={498} textAnchor="middle" fill="#000" fontSize={11} fontWeight="bold">Middleware</text>
            <text x={100} y={516} textAnchor="middle" fill="#000" fontSize={10}>Rate Limiting</text>
            <text x={100} y={532} textAnchor="middle" fill="#000" fontSize={10}>CORS</text>
            <text x={100} y={548} textAnchor="middle" fill="#000" fontSize={10}>Request Logging</text>
            <text x={100} y={564} textAnchor="middle" fill="#000" fontSize={10}>Panic Recovery</text>

            {/* ── Lines down to DB ── */}
            <line x1={270} y1={440} x2={270} y2={510} stroke="#000" strokeWidth={1.5} />
            <line x1={615} y1={440} x2={615} y2={510} stroke="#000" strokeWidth={1.5} />
            <line x1={270} y1={510} x2={615} y2={510} stroke="#000" strokeWidth={1.5} />
            <line x1={440} y1={510} x2={440} y2={535} stroke="#000" strokeWidth={1.5} />

            {/* DB access labels */}
            <text x={270} y={505} textAnchor="middle" fill="#666" fontSize={8}>lib/pq</text>
            <text x={615} y={505} textAnchor="middle" fill="#666" fontSize={8}>psycopg2</text>

            {/* ── Database ── */}
            <rect x={310} y={535} width={260} height={50} fill="#fff" stroke="#000" strokeWidth={1.5} />
            <text x={440} y={556} textAnchor="middle" fontSize={14} fill="#000">PostgreSQL</text>
            <text x={440} y={573} textAnchor="middle" fontSize={11} fill="#000">(meta_source)</text>

            {/* ── Table names ── */}
            <line x1={440} y1={585} x2={440} y2={610} stroke="#000" strokeWidth={1.5} />
            <line x1={70} y1={610} x2={680} y2={610} stroke="#000" strokeWidth={1} />

            {[
              { x: 70, label: "Requisition" },
              { x: 190, label: "Change" },
              { x: 310, label: "Notification" },
              { x: 430, label: "Manager" },
              { x: 550, label: "MarketRate" },
              { x: 650, label: "ScrapeLog" },
            ].map((t) => (
              <g key={t.label}>
                <line x1={t.x} y1={610} x2={t.x} y2={624} stroke="#000" strokeWidth={1} />
                <text x={t.x} y={640} textAnchor="middle" fontSize={10} fill="#000">{t.label}</text>
              </g>
            ))}
          </svg>
        </div>

        {/* ── Notification Flowchart ── */}
        <div className="mt-16 mb-16">
          <h2 className="text-xl font-mono font-bold text-gray-900 mb-2">Notification Flow</h2>
          <p className="text-sm text-gray-500 mb-8 font-mono">How every requisition change reaches the right manager in real time</p>

          <div className="flex justify-center overflow-x-auto">
            <svg width={780} height={920} viewBox="0 0 780 920" className="max-w-full" style={{ fontFamily: "'Courier New', Courier, monospace" }}>
              {/* ── Step 1: User Action (trigger) ── */}
              <rect x={270} y={10} width={240} height={44} rx={22} fill="#1e293b" stroke="none" />
              <text x={390} y={37} textAnchor="middle" fontSize={13} fill="#fff" fontWeight="bold">User Action</text>
              <text x={270} y={72} textAnchor="middle" fontSize={9} fill="#64748b">Create</text>
              <text x={340} y={72} textAnchor="middle" fontSize={9} fill="#64748b">Update</text>
              <text x={410} y={72} textAnchor="middle" fontSize={9} fill="#64748b">Delete</text>
              <text x={490} y={72} textAnchor="middle" fontSize={9} fill="#64748b">CSV Import</text>

              {/* Arrow down */}
              <line x1={390} y1={54} x2={390} y2={90} stroke="#334155" strokeWidth={1.5} />
              <polygon points="386,86 394,86 390,94" fill="#334155" />

              {/* ── Step 2: API Call ── */}
              <rect x={250} y={96} width={280} height={40} fill="#fff" stroke="#334155" strokeWidth={1.5} rx={4} />
              <text x={390} y={115} textAnchor="middle" fontSize={11} fill="#334155">PUT /api/requisitions/:id</text>
              <text x={390} y={128} textAnchor="middle" fontSize={9} fill="#94a3b8">POST /api/requisitions/upload</text>

              {/* Arrow down */}
              <line x1={390} y1={136} x2={390} y2={160} stroke="#334155" strokeWidth={1.5} />
              <polygon points="386,156 394,156 390,164" fill="#334155" />

              {/* ── Step 3: Go Gateway (big box) ── */}
              <rect x={100} y={166} width={580} height={260} fill="#f8fafc" stroke="#334155" strokeWidth={1.5} rx={6} />
              <text x={390} y={188} textAnchor="middle" fontSize={14} fill="#0f172a" fontWeight="bold">Go Gateway</text>
              <text x={390} y={202} textAnchor="middle" fontSize={9} fill="#64748b">requisitions.go / upload.go</text>

              {/* Sub-step 3a: Query old values */}
              <rect x={130} y={215} width={220} height={36} fill="#fff" stroke="#475569" strokeWidth={1} rx={3} />
              <text x={240} y={232} textAnchor="middle" fontSize={10} fill="#0f172a">1. Query old values from DB</text>
              <text x={240} y={244} textAnchor="middle" fontSize={8} fill="#94a3b8">SELECT status, rate, headcount...</text>

              {/* Sub-step 3b: Field-level diff */}
              <rect x={130} y={260} width={220} height={36} fill="#fff" stroke="#475569" strokeWidth={1} rx={3} />
              <text x={240} y={277} textAnchor="middle" fontSize={10} fill="#0f172a">2. Field-level diff (track fn)</text>
              <text x={240} y={289} textAnchor="middle" fontSize={8} fill="#94a3b8">Compare old vs new per field</text>

              {/* Arrow between sub-steps */}
              <line x1={240} y1={251} x2={240} y2={260} stroke="#94a3b8" strokeWidth={1} />

              {/* Sub-step 3c: Execute UPDATE */}
              <rect x={130} y={305} width={220} height={36} fill="#fff" stroke="#475569" strokeWidth={1} rx={3} />
              <text x={240} y={322} textAnchor="middle" fontSize={10} fill="#0f172a">3. Execute UPDATE + INSERT</text>
              <text x={240} y={334} textAnchor="middle" fontSize={8} fill="#94a3b8">RequisitionChange records saved</text>

              <line x1={240} y1={296} x2={240} y2={305} stroke="#94a3b8" strokeWidth={1} />

              {/* Right side: What gets tracked */}
              <rect x={400} y={215} width={250} height={130} fill="#fff" stroke="#475569" strokeWidth={1} rx={3} strokeDasharray="4 2" />
              <text x={525} y={234} textAnchor="middle" fontSize={10} fill="#0f172a" fontWeight="bold">Tracked Fields</text>
              {[
                { y: 250, field: "status", type: "STATUS_CHANGE" },
                { y: 263, field: "priority", type: "UPDATED" },
                { y: 276, field: "headcountNeeded", type: "HEADCOUNT_CHANGE" },
                { y: 289, field: "billRateHourly", type: "RATE_CHANGE" },
                { y: 302, field: "budgetAllocated", type: "BUDGET_CHANGE" },
                { y: 315, field: "vendor, location", type: "UPDATED" },
              ].map((r) => (
                <g key={r.field}>
                  <text x={420} y={r.y} fontSize={9} fill="#334155">{r.field}</text>
                  <text x={635} y={r.y} textAnchor="end" fontSize={8} fill="#64748b">{r.type}</text>
                </g>
              ))}

              {/* Sub-step 3d: Route to manager */}
              <rect x={130} y={355} width={520} height={30} fill="#dbeafe" stroke="#3b82f6" strokeWidth={1} rx={3} />
              <text x={390} y={374} textAnchor="middle" fontSize={10} fill="#1e40af">4. Route to manager by category (SELECT id FROM SourcingManager WHERE category = $1)</text>

              <line x1={240} y1={341} x2={240} y2={355} stroke="#94a3b8" strokeWidth={1} />

              {/* ── Arrows fanning out to 4 outputs ── */}
              <line x1={390} y1={426} x2={390} y2={450} stroke="#334155" strokeWidth={1.5} />
              <line x1={100} y1={450} x2={680} y2={450} stroke="#334155" strokeWidth={1.5} />

              {/* 4 vertical drops */}
              <line x1={100} y1={450} x2={100} y2={475} stroke="#334155" strokeWidth={1.5} />
              <line x1={295} y1={450} x2={295} y2={475} stroke="#334155" strokeWidth={1.5} />
              <line x1={488} y1={450} x2={488} y2={475} stroke="#334155" strokeWidth={1.5} />
              <line x1={680} y1={450} x2={680} y2={475} stroke="#334155" strokeWidth={1.5} />

              <polygon points="96,471 104,471 100,479" fill="#334155" />
              <polygon points="291,471 299,471 295,479" fill="#334155" />
              <polygon points="484,471 492,471 488,479" fill="#334155" />
              <polygon points="676,471 684,471 680,479" fill="#334155" />

              {/* ── Output 1: RequisitionChange DB ── */}
              <rect x={20} y={480} width={160} height={60} fill="#fff" stroke="#334155" strokeWidth={1.5} rx={4} />
              <text x={100} y={500} textAnchor="middle" fontSize={10} fill="#0f172a" fontWeight="bold">Audit Trail</text>
              <text x={100} y={515} textAnchor="middle" fontSize={9} fill="#64748b">INSERT into</text>
              <text x={100} y={528} textAnchor="middle" fontSize={9} fill="#334155">RequisitionChange</text>

              {/* ── Output 2: Notification DB ── */}
              <rect x={212} y={480} width={166} height={60} fill="#fff" stroke="#334155" strokeWidth={1.5} rx={4} />
              <text x={295} y={500} textAnchor="middle" fontSize={10} fill="#0f172a" fontWeight="bold">DB Notification</text>
              <text x={295} y={515} textAnchor="middle" fontSize={9} fill="#64748b">INSERT into</text>
              <text x={295} y={528} textAnchor="middle" fontSize={9} fill="#334155">Notification (per manager)</text>

              {/* ── Output 3: WebSocket ── */}
              <rect x={405} y={480} width={166} height={60} fill="#eff6ff" stroke="#3b82f6" strokeWidth={1.5} rx={4} />
              <text x={488} y={500} textAnchor="middle" fontSize={10} fill="#1e40af" fontWeight="bold">WebSocket Push</text>
              <text x={488} y={515} textAnchor="middle" fontSize={9} fill="#3b82f6">NotifHub.Broadcast()</text>
              <text x={488} y={528} textAnchor="middle" fontSize={9} fill="#64748b">instant, per-manager</text>

              {/* ── Output 4: SNS ── */}
              <rect x={598} y={480} width={166} height={60} fill="#fef3c7" stroke="#f59e0b" strokeWidth={1.5} rx={4} />
              <text x={681} y={500} textAnchor="middle" fontSize={10} fill="#92400e" fontWeight="bold">AWS SNS Publish</text>
              <text x={681} y={515} textAnchor="middle" fontSize={9} fill="#b45309">PublishChange()</text>
              <text x={681} y={528} textAnchor="middle" fontSize={9} fill="#64748b">async goroutine</text>

              {/* ── WebSocket path continues ── */}
              <line x1={488} y1={540} x2={488} y2={570} stroke="#3b82f6" strokeWidth={1.5} />
              <polygon points="484,566 492,566 488,574" fill="#3b82f6" />

              {/* WebSocket Hub detail */}
              <rect x={370} y={576} width={236} height={80} fill="#eff6ff" stroke="#3b82f6" strokeWidth={1} rx={4} strokeDasharray="4 2" />
              <text x={488} y={594} textAnchor="middle" fontSize={10} fill="#1e40af" fontWeight="bold">WebSocket Hub</text>
              <text x={488} y={610} textAnchor="middle" fontSize={9} fill="#3b82f6">connections: managerId -&gt; []*Conn</text>
              <text x={488} y={626} textAnchor="middle" fontSize={9} fill="#3b82f6">broadcast chan (buffer: 256)</text>
              <text x={488} y={642} textAnchor="middle" fontSize={9} fill="#64748b">sends to manager + admin conns</text>

              {/* Arrow from WS Hub to Frontend */}
              <line x1={488} y1={656} x2={488} y2={686} stroke="#3b82f6" strokeWidth={1.5} />
              <polygon points="484,682 492,682 488,690" fill="#3b82f6" />

              {/* ── SNS path continues ── */}
              <line x1={681} y1={540} x2={681} y2={576} stroke="#f59e0b" strokeWidth={1.5} />
              <polygon points="677,572 685,572 681,580" fill="#f59e0b" />

              {/* SNS Topic */}
              <rect x={608} y={580} width={146} height={52} fill="#fef3c7" stroke="#f59e0b" strokeWidth={1} rx={4} />
              <text x={681} y={598} textAnchor="middle" fontSize={9} fill="#92400e" fontWeight="bold">SNS Topic</text>
              <text x={681} y={612} textAnchor="middle" fontSize={8} fill="#b45309">metasource-</text>
              <text x={681} y={624} textAnchor="middle" fontSize={8} fill="#b45309">requisition-changes</text>

              {/* Arrow from SNS to Email */}
              <line x1={681} y1={632} x2={681} y2={660} stroke="#f59e0b" strokeWidth={1.5} />
              <polygon points="677,656 685,656 681,664" fill="#f59e0b" />

              {/* Email delivery */}
              <rect x={618} y={666} width={126} height={44} rx={22} fill="#f59e0b" stroke="none" />
              <text x={681} y={685} textAnchor="middle" fontSize={10} fill="#fff" fontWeight="bold">Email Sent</text>
              <text x={681} y={698} textAnchor="middle" fontSize={8} fill="#fef3c7">~1-2s delivery</text>

              {/* ── Frontend (receives WS) ── */}
              <rect x={130} y={692} width={480} height={210} fill="#f0fdf4" stroke="#22c55e" strokeWidth={1.5} rx={6} />
              <text x={370} y={714} textAnchor="middle" fontSize={13} fill="#14532d" fontWeight="bold">Frontend (Next.js)</text>
              <text x={370} y={728} textAnchor="middle" fontSize={9} fill="#64748b">use-websocket.ts / ws-context.tsx / layout.tsx</text>

              {/* WS receives */}
              <rect x={155} y={740} width={200} height={44} fill="#fff" stroke="#16a34a" strokeWidth={1} rx={3} />
              <text x={255} y={757} textAnchor="middle" fontSize={10} fill="#14532d">WebSocket onmessage</text>
              <text x={255} y={770} textAnchor="middle" fontSize={8} fill="#64748b">parse JSON: type + payload</text>

              {/* Sequence counter */}
              <rect x={155} y={792} width={200} height={36} fill="#fff" stroke="#16a34a" strokeWidth={1} rx={3} />
              <text x={255} y={808} textAnchor="middle" fontSize={10} fill="#14532d">Increment sequence counter</text>
              <text x={255} y={820} textAnchor="middle" fontSize={8} fill="#64748b">notificationSequence++</text>

              <line x1={255} y1={784} x2={255} y2={792} stroke="#16a34a" strokeWidth={1} />

              {/* Toast */}
              <rect x={385} y={740} width={200} height={44} fill="#fff" stroke="#16a34a" strokeWidth={1} rx={3} />
              <text x={485} y={757} textAnchor="middle" fontSize={10} fill="#14532d">Show Toast</text>
              <text x={485} y={770} textAnchor="middle" fontSize={8} fill="#64748b">&quot;Requisition Updated&quot;</text>

              {/* Badge update */}
              <rect x={385} y={792} width={200} height={36} fill="#fff" stroke="#16a34a" strokeWidth={1} rx={3} />
              <text x={485} y={808} textAnchor="middle" fontSize={10} fill="#14532d">Update Bell Badge</text>
              <text x={485} y={820} textAnchor="middle" fontSize={8} fill="#64748b">fetchUnread() -&gt; red count</text>

              <line x1={485} y1={784} x2={485} y2={792} stroke="#16a34a" strokeWidth={1} />

              {/* Silent refetch */}
              <rect x={220} y={838} width={300} height={36} fill="#dcfce7" stroke="#16a34a" strokeWidth={1} rx={3} />
              <text x={370} y={855} textAnchor="middle" fontSize={10} fill="#14532d">Notifications page auto-refetches</text>
              <text x={370} y={867} textAnchor="middle" fontSize={8} fill="#64748b">silent re-query on sequence change</text>

              <line x1={255} y1={828} x2={255} y2={838} stroke="#16a34a" strokeWidth={1} />
              <line x1={255} y1={838} x2={370} y2={838} stroke="#16a34a" strokeWidth={1} />

              {/* ── Latency labels ── */}
              <rect x={15} y={695} width={100} height={28} rx={4} fill="#e2e8f0" stroke="none" />
              <text x={65} y={714} textAnchor="middle" fontSize={9} fill="#475569" fontWeight="bold">~50ms</text>
              <text x={65} y={714} textAnchor="middle" fontSize={9} fill="#475569" fontWeight="bold">WebSocket</text>

              <rect x={15} y={728} width={100} height={28} rx={4} fill="#fef3c7" stroke="none" />
              <text x={65} y={747} textAnchor="middle" fontSize={9} fill="#92400e" fontWeight="bold">~1-2s Email</text>
            </svg>
          </div>

          {/* Legend */}
          <div className="mt-8 flex flex-wrap justify-center gap-6 text-xs font-mono">
            <div className="flex items-center gap-2">
              <div className="w-4 h-3 rounded bg-[#eff6ff] border border-[#3b82f6]" />
              <span className="text-gray-600">WebSocket (instant)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-3 rounded bg-[#fef3c7] border border-[#f59e0b]" />
              <span className="text-gray-600">AWS SNS (email)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-3 rounded bg-[#f0fdf4] border border-[#22c55e]" />
              <span className="text-gray-600">Frontend (Next.js)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-3 rounded bg-[#f8fafc] border border-[#334155]" />
              <span className="text-gray-600">Go Gateway</span>
            </div>
          </div>
        </div>

        <hr className="border-gray-200 my-8" />

        {/* Tech Stack */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="border border-gray-300 rounded p-5">
            <h3 className="font-mono font-bold text-gray-900 mb-3">Frontend</h3>
            <ul className="space-y-1 text-sm text-gray-700 font-mono">
              <li>Next.js 15 (App Router)</li>
              <li>TypeScript + Tailwind</li>
              <li>Tanstack Table</li>
              <li>Recharts</li>
              <li>Radix UI</li>
              <li>NextAuth.js (Google OAuth)</li>
            </ul>
          </div>
          <div className="border border-gray-300 rounded p-5">
            <h3 className="font-mono font-bold text-gray-900 mb-3">Go Gateway</h3>
            <ul className="space-y-1 text-sm text-gray-700 font-mono">
              <li>Gin HTTP framework</li>
              <li>gorilla/websocket</li>
              <li>lib/pq (PostgreSQL)</li>
              <li>Rate limiting (100 rps)</li>
              <li>Structured JSON logging</li>
              <li>Request tracing</li>
            </ul>
          </div>
          <div className="border border-gray-300 rounded p-5">
            <h3 className="font-mono font-bold text-gray-900 mb-3">AI Service</h3>
            <ul className="space-y-1 text-sm text-gray-700 font-mono">
              <li>Python FastAPI</li>
              <li>OpenAI Agent SDK</li>
              <li>GPT-4.1 + GPT-4.1-mini</li>
              <li>6 database query tools</li>
              <li>httpx + BeautifulSoup (web scraping)</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
