import { toast } from "sonner"

/**
 * Safely open a file. If the file is missing or deleted, shows a toast error.
 * @param {string} filepath
 */
export async function safeOpenFile(filepath) {
    if (!filepath) {
        toast.error("No file path provided.")
        return
    }
    const res = await window.api.openFile(filepath)
    if (res && res.found === false) {
        toast.error(res.error || "File not found — it may have been moved or deleted.")
    }
}
