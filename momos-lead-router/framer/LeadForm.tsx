import { useState, useRef } from "react"

// After `npm run deploy` in /worker, paste the Worker URL here.
const ENDPOINT = "https://momos-lead-routing.YOUR-SUBDOMAIN.workers.dev"
const FALLBACK = "/book"
const TERMS_URL = "/terms-of-service"
const PRIVACY_URL = "/privacy-policy"

const RED = "#C94A3E"
const TEXT = "#1A1A1A"
const MUTED = "#8A8A8A"
const INPUT_BG = "#F5F4F2"

const COUNTRIES = {
  na: [["US", "🇺🇸 United States"], ["CA", "🇨🇦 Canada"], ["MX", "🇲🇽 Mexico"]],
  other: [
    ["GB", "🇬🇧 United Kingdom"], ["IE", "🇮🇪 Ireland"], ["FR", "🇫🇷 France"], ["DE", "🇩🇪 Germany"],
    ["ES", "🇪🇸 Spain"], ["IT", "🇮🇹 Italy"], ["NL", "🇳🇱 Netherlands"], ["TR", "🇹🇷 Turkey"],
    ["AE", "🇦🇪 United Arab Emirates"], ["SA", "🇸🇦 Saudi Arabia"], ["QA", "🇶🇦 Qatar"], ["KW", "🇰🇼 Kuwait"],
    ["AU", "🇦🇺 Australia"], ["NZ", "🇳🇿 New Zealand"], ["SG", "🇸🇬 Singapore"], ["MY", "🇲🇾 Malaysia"],
    ["TH", "🇹🇭 Thailand"], ["VN", "🇻🇳 Vietnam"], ["PH", "🇵🇭 Philippines"], ["ID", "🇮🇩 Indonesia"],
    ["JP", "🇯🇵 Japan"], ["KR", "🇰🇷 South Korea"], ["HK", "🇭🇰 Hong Kong"], ["IN", "🇮🇳 India"],
    ["OTHER", "🌍 Other"],
  ],
}
const LOCATIONS = ["1-5", "6-49", "50-249", "250+"]

const s = {
  wrap: { width: "100%", fontFamily: "inherit", color: TEXT },
  tabs: { display: "flex", justifyContent: "center", gap: 40, marginBottom: 24, borderBottom: "1px solid #E8E6E3" },
  tab: (active) => ({
    background: "none", border: "none", padding: "0 4px 14px", fontSize: 26, cursor: "pointer",
    fontFamily: "inherit", fontWeight: active ? 700 : 400, color: active ? TEXT : "#6B6B6B",
    borderBottom: active ? `3px solid ${RED}` : "3px solid transparent", marginBottom: -1,
  }),
  card: { background: "#fff", borderRadius: 24, padding: 48, boxShadow: "0 8px 40px rgba(0,0,0,0.04)" },
  row: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 24, marginBottom: 28 },
  label: { display: "block", fontSize: 18, marginBottom: 12 },
  input: {
    width: "100%", boxSizing: "border-box", padding: "20px 24px", fontSize: 18, fontFamily: "inherit",
    background: INPUT_BG, border: "1px solid #EEECE9", borderRadius: 12, color: TEXT, outline: "none",
  },
  radios: { display: "flex", flexWrap: "wrap", gap: 40, marginTop: 8, marginBottom: 32 },
  radio: { display: "flex", alignItems: "center", gap: 12, fontSize: 18, cursor: "pointer" },
  button: (loading) => ({
    width: "100%", padding: "22px", fontSize: 22, fontWeight: 600, color: "#fff", border: "none",
    borderRadius: 14, cursor: loading ? "default" : "pointer", fontFamily: "inherit",
    background: `linear-gradient(90deg, ${RED} 0%, #E9817B 100%)`,
    boxShadow: "0 8px 24px rgba(201,74,62,0.25)", opacity: loading ? 0.8 : 1,
  }),
  consent: { fontSize: 16, color: "#6B6B6B", textAlign: "center", marginTop: 20 },
  link: { color: "#2F5BEA" },
}

export default function LeadForm() {
  const [tab, setTab] = useState("na")
  const [loading, setLoading] = useState(false)
  const loadedAt = useRef(Date.now())

  async function onSubmit(e) {
    e.preventDefault()
    if (loading) return
    setLoading(true)

    const data = Object.fromEntries(new FormData(e.target))
    const params = new URLSearchParams(window.location.search)
    data.region_tab = tab
    data.elapsedMs = Date.now() - loadedAt.current
    data.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    data.pageUrl = window.location.href
    data.referrer = document.referrer
    ;["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_channel", "gclid"].forEach((k) => {
      if (params.get(k)) data[k] = params.get(k)
    })

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 3000)
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        // text/plain skips the CORS preflight, which saves a full round trip.
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(data),
        signal: ctrl.signal,
      })
      const { url } = await res.json()
      window.top.location.href = url
    } catch {
      window.top.location.href = FALLBACK
    } finally {
      clearTimeout(timer)
    }
  }

  return (
    <div style={s.wrap}>
      <div style={s.tabs}>
        <button type="button" style={s.tab(tab === "na")} onClick={() => setTab("na")}>US, Canada & Mexico</button>
        <button type="button" style={s.tab(tab === "other")} onClick={() => setTab("other")}>Other regions</button>
      </div>

      <form onSubmit={onSubmit} style={s.card}>
        <input name="website" tabIndex={-1} autoComplete="off" style={{ display: "none" }} />

        <div style={s.row}>
          <div>
            <label style={s.label}>First Name*</label>
            <input name="firstName" placeholder="Enter your first name" required style={s.input} />
          </div>
          <div>
            <label style={s.label}>Last Name*</label>
            <input name="lastName" placeholder="Enter your last name" required style={s.input} />
          </div>
        </div>

        <div style={{ marginBottom: 28 }}>
          <label style={s.label}>Work Email*</label>
          <input name="email" type="email" placeholder="Enter your work email" required style={s.input} />
        </div>

        <div style={s.row}>
          <div>
            <label style={s.label}>Company*</label>
            <input name="company" placeholder="Enter your company" required style={s.input} />
          </div>
          <div>
            <label style={s.label}>Job Title*</label>
            <input name="title" placeholder="Enter your job title" required style={s.input} />
          </div>
        </div>

        <div style={{ marginBottom: 28 }}>
          <label style={s.label}>Country*</label>
          <select key={tab} name="country" required defaultValue={COUNTRIES[tab][0][0]} style={s.input}>
            {COUNTRIES[tab].map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
        </div>

        <label style={s.label}>How many locations does your restaurant/franchise have?*</label>
        <div style={s.radios}>
          {LOCATIONS.map((v) => (
            <label key={v} style={s.radio}>
              <input type="radio" name="locations" value={v} required style={{ width: 22, height: 22, accentColor: RED }} />
              {v}
            </label>
          ))}
        </div>

        <button type="submit" disabled={loading} style={s.button(loading)}>
          {loading ? "Finding your calendar..." : "Book a Demo"}
        </button>

        <p style={s.consent}>
          By clicking the button, I agree to Momos <a href={TERMS_URL} style={s.link}>Terms of Service</a> and{" "}
          <a href={PRIVACY_URL} style={s.link}>Privacy Policy</a>
        </p>
      </form>
    </div>
  )
}
