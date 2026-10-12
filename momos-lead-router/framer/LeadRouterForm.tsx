// Framer code component. In Framer: Assets > Code > New file, paste this in,
// then drag "LeadRouterForm" onto the Book a Demo page.
// On submit it asks the router who should take the lead and sends the visitor
// straight to that AE's booking page.
import { useState, type CSSProperties, type FormEvent } from "react"
import { addPropertyControls, ControlType } from "framer"

type Props = {
    routerUrl: string
    fallbackUrl: string
    buttonLabel: string
    accent: string
    style?: CSSProperties
}

const FIELDS: { name: string; label: string; type?: string; required?: boolean }[] = [
    { name: "firstName", label: "First name", required: true },
    { name: "lastName", label: "Last name", required: true },
    { name: "email", label: "Work email", type: "email", required: true },
    { name: "phone", label: "Phone", type: "tel" },
    { name: "company", label: "Brand / company", required: true },
    { name: "website", label: "Website" },
    { name: "jobTitle", label: "Job title" },
    { name: "locations", label: "Number of locations", required: true },
    { name: "country", label: "Country", required: true },
    { name: "state", label: "State / province" },
]

/**
 * @framerSupportedLayoutWidth any
 * @framerSupportedLayoutHeight auto
 */
export default function LeadRouterForm(props: Props) {
    const { routerUrl, fallbackUrl, buttonLabel, accent, style } = props
    const [busy, setBusy] = useState(false)

    async function onSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault()
        if (busy) return
        setBusy(true)
        const data = Object.fromEntries(new FormData(e.currentTarget).entries())
        try {
            const ctrl = new AbortController()
            const timer = setTimeout(() => ctrl.abort(), 15000)
            const res = await fetch(routerUrl, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(data),
                signal: ctrl.signal,
            })
            clearTimeout(timer)
            const json = await res.json()
            window.location.href = json.redirectUrl || fallbackUrl
        } catch {
            // If the router can't answer, the visitor still gets a booking page.
            window.location.href = fallbackUrl
        }
    }

    const input: CSSProperties = {
        width: "100%",
        padding: "12px 14px",
        border: "1px solid #d9d9e0",
        borderRadius: 8,
        fontSize: 15,
        boxSizing: "border-box",
        fontFamily: "inherit",
    }

    return (
        <form onSubmit={onSubmit} style={{ display: "grid", gap: 12, width: "100%", ...style }}>
            {FIELDS.map((f) => (
                <label key={f.name} style={{ display: "grid", gap: 6, fontSize: 14 }}>
                    {f.label}
                    {f.required ? " *" : ""}
                    <input name={f.name} type={f.type ?? "text"} required={f.required} style={input} />
                </label>
            ))}
            <label style={{ display: "grid", gap: 6, fontSize: 14 }}>
                Anything we should know?
                <textarea name="message" rows={3} style={input} />
            </label>
            <button
                type="submit"
                disabled={busy}
                style={{
                    padding: "14px 18px",
                    border: 0,
                    borderRadius: 8,
                    background: accent,
                    color: "#fff",
                    fontSize: 16,
                    fontWeight: 600,
                    cursor: busy ? "wait" : "pointer",
                    opacity: busy ? 0.7 : 1,
                }}
            >
                {busy ? "Finding the right person for you..." : buttonLabel}
            </button>
        </form>
    )
}

LeadRouterForm.defaultProps = {
    routerUrl: "https://YOUR-ROUTER-HOST/api/route",
    fallbackUrl: "https://www.momos.com/book-a-demo-us",
    buttonLabel: "Book a demo",
    accent: "#5b3df5",
}

addPropertyControls(LeadRouterForm, {
    routerUrl: { type: ControlType.String, title: "Router URL" },
    fallbackUrl: { type: ControlType.String, title: "Fallback URL" },
    buttonLabel: { type: ControlType.String, title: "Button" },
    accent: { type: ControlType.Color, title: "Accent" },
})
