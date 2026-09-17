import { createContext, useContext, useState, useEffect, useCallback } from "react"
import { toast } from "sonner"

const ScrapeContext = createContext(null)

export function useScrape() {
    return useContext(ScrapeContext)
}

const INITIAL_STATE = {
    active: false,
    step: 1,           // 1=launch, 2=config, 3=scraping, 4=done
    progress: 0,
    leadsScraped: 0,
    speed: 0,
    skipped: 0,
    currentLead: "",
    maxLeads: 200,
    listName: "",
    url: "",
    result: null,      // { totalLeads, filepath, stopped }
    error: null,
}

const openFileAction = (filepath) => filepath
    ? { label: "Open File", onClick: () => window.api.openFile(filepath) }
    : undefined

export function ScrapeProvider({ children }) {
    const [scrapeState, setScrapeState] = useState(INITIAL_STATE)

    // App-level listeners so progress survives page navigation
    useEffect(() => {
        const offProgress = window.api.onProgress((data) => {
            if (data.phase === "starting") {
                setScrapeState(s => ({ ...s, active: true, step: 3, progress: 0, leadsScraped: 0, speed: 0, skipped: 0, currentLead: "" }))
            } else if (data.phase === "scraping") {
                setScrapeState(s => ({
                    ...s,
                    active: true,
                    step: 3,
                    progress: Math.min(((data.leadsScraped || 0) / (data.maxLeads || s.maxLeads || 200)) * 100, 100),
                    leadsScraped: data.leadsScraped || 0,
                    speed: data.speed || 0,
                    skipped: data.skipped || 0,
                    currentLead: data.name || s.currentLead,
                }))
            } else if (data.phase === "complete" || data.phase === "stopped") {
                const stopped = data.phase === "stopped"
                setScrapeState(s => ({
                    ...s,
                    active: false,
                    step: 4,
                    progress: 100,
                    result: { totalLeads: data.totalLeads ?? s.leadsScraped, filepath: data.filepath, stopped },
                    error: null,
                }))
                const message = stopped
                    ? `Scrape stopped — ${data.totalLeads || 0} leads saved.`
                    : `Scrape complete! ${data.totalLeads || 0} leads saved.`
                toast.success(message, { duration: 8000, action: openFileAction(data.filepath) })
            } else if (data.phase === "failed") {
                if (data.filepath) {
                    // Some leads were saved before the failure — show them as a partial result
                    setScrapeState(s => ({
                        ...s,
                        active: false,
                        step: 4,
                        progress: 100,
                        result: { totalLeads: data.totalLeads, filepath: data.filepath, stopped: true },
                        error: data.error,
                    }))
                    toast.warning(`Scrape failed, but ${data.totalLeads} leads were saved: ${data.error}`, {
                        duration: 10000,
                        action: openFileAction(data.filepath),
                    })
                } else {
                    setScrapeState(s => ({ ...s, active: false, step: 2, error: data.error }))
                    toast.error(data.error, { duration: 10000 })
                }
            }
        })

        // Per-lead errors are skips, not failures; the scrape keeps going.
        // Fatal errors arrive as a "failed" progress event.
        const offIssue = window.api.onIssue((issue) => {
            if (issue.type === "error") {
                toast.warning(issue.message, { duration: 4000 })
            }
        })

        return () => {
            offProgress?.()
            offIssue?.()
        }
    }, [])

    // Restore an active session after a renderer reload
    useEffect(() => {
        window.api.getScrapeStatus()
            .then((status) => {
                if (!status?.isActive) return
                setScrapeState(s => ({
                    ...s,
                    active: true,
                    step: 3,
                    leadsScraped: status.leadsCount || 0,
                    maxLeads: status.progress?.maxLeads || s.maxLeads,
                    progress: status.progress
                        ? Math.min((status.progress.leadsScraped / (status.progress.maxLeads || 200)) * 100, 100)
                        : 0,
                }))
            })
            .catch(() => { })
    }, [])

    const startScrape = useCallback(async (form) => {
        const maxLeads = Number(form.maxLeads) || 200
        setScrapeState(s => ({
            ...s,
            active: true,
            step: 3,
            progress: 0,
            leadsScraped: 0,
            speed: 0,
            skipped: 0,
            currentLead: "",
            maxLeads,
            listName: form.listName || "",
            url: form.url || "",
            result: null,
            error: null,
        }))

        let result
        try {
            result = await window.api.startScraping({ ...form, maxLeads })
        } catch (err) {
            result = { success: false, error: err?.message || "Unknown error" }
        }

        // Failures the main process already broadcast are handled by the listener above
        if (result?.success || result?.notified) return

        const error = result?.error || "Unknown error"
        setScrapeState(s => ({ ...s, active: false, step: 2, error }))
        toast.error(error, { duration: 10000 })
    }, [])

    const stopScrape = useCallback(async () => {
        await window.api.stopScraping()
    }, [])

    const resetScrape = useCallback(() => {
        setScrapeState(INITIAL_STATE)
    }, [])

    const goToStep = useCallback((step) => {
        setScrapeState(s => ({ ...s, step, error: null }))
    }, [])

    return (
        <ScrapeContext.Provider value={{ scrapeState, startScrape, stopScrape, resetScrape, goToStep }}>
            {children}
        </ScrapeContext.Provider>
    )
}
