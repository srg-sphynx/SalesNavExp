import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { useTheme } from "@/components/ThemeProvider"
import {
    HardDrive, RotateCcw, Save, CheckCircle2, XCircle,
    Loader2, AlertCircle, FolderOpen
} from "lucide-react"

export default function SettingsPage() {
    const { theme, setTheme } = useTheme()
    const [settings, setSettings] = useState({
        outputDir: "",
        csvSeparator: ",",
        maxLeadsPerScrape: 200,
        delayBetweenLeads: 1500,
        autoOpenFileAfterScrape: true,
        includeTimestampInFilename: true,
    })
    const [driveStatus, setDriveStatus] = useState({ connected: false, email: null })
    const [driveError, setDriveError] = useState(null)
    const [driveLoading, setDriveLoading] = useState(false)
    const [saved, setSaved] = useState(false)
    const [resetting, setResetting] = useState(false)

    useEffect(() => {
        loadSettings()
        checkDriveStatus()
    }, [])

    const loadSettings = async () => {
        try {
            const data = await window.api.getSettings()
            if (data) setSettings(prev => ({ ...prev, ...data }))
        } catch (err) {
            console.error("Failed to load settings:", err)
        }
    }

    const checkDriveStatus = async () => {
        try {
            const status = await window.api.driveStatus()
            setDriveStatus({
                connected: !!status?.connected,
                email: (status?.email && status.email !== 'null') ? status.email : null
            })
        } catch {
            setDriveStatus({ connected: false, email: null })
        }
    }

    const handleSave = async () => {
        try {
            await window.api.saveSettings(settings)
            setSaved(true)
            setTimeout(() => setSaved(false), 2500)
        } catch (err) {
            console.error("Failed to save settings:", err)
        }
    }

    const handleReset = async () => {
        setResetting(true)
        try {
            await window.api.resetSettings()
            await loadSettings()
        } catch (err) {
            console.error("Reset failed:", err)
        } finally {
            setResetting(false)
        }
    }

    const handleBrowse = async () => {
        try {
            const result = await window.api.selectOutputFolder()
            if (result?.path) {
                setSettings(s => ({ ...s, outputDir: result.path }))
            }
        } catch (err) {
            console.error("Folder pick failed:", err)
        }
    }

    const handleDriveToggle = async () => {
        setDriveLoading(true)
        setDriveError(null)
        try {
            if (driveStatus.connected) {
                await window.api.driveDisconnect()
                setDriveStatus({ connected: false, email: null })
            } else {
                const result = await window.api.driveConnect()
                if (result?.success) {
                    const email = (result.email && result.email !== 'null') ? result.email : null
                    setDriveStatus({ connected: true, email })
                } else {
                    setDriveError(result?.error || "Connection failed. Check credentials.json is in the app folder.")
                }
            }
        } catch (err) {
            setDriveError(err?.message || "Drive connection error")
        } finally {
            setDriveLoading(false)
        }
    }

    return (
        <div className="flex flex-col h-full">
            {/* Sticky Page Header */}
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-8 py-4 flex-shrink-0">
                <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
                <p className="text-sm text-muted-foreground">Manage preferences and integrations</p>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-8 py-6">
                <div className="max-w-3xl mx-auto space-y-6">

                    {/* Appearance */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Appearance</CardTitle>
                            <CardDescription>Customize how the scraper looks.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="w-48 space-y-2">
                                <Label>Theme</Label>
                                <Select value={theme} onValueChange={setTheme}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="light">Light</SelectItem>
                                        <SelectItem value="dark">Dark</SelectItem>
                                        <SelectItem value="system">System</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Output Configuration */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Output Configuration</CardTitle>
                            <CardDescription>Where and how your scraped data is saved.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>Save Location</Label>
                                <div className="flex gap-2">
                                    <Input
                                        value={settings.outputDir}
                                        readOnly
                                        placeholder="Default: Downloads/LinkedIn Scraper/"
                                        className="text-sm"
                                    />
                                    <Button variant="secondary" onClick={handleBrowse}>
                                        <FolderOpen className="w-4 h-4 mr-1" /> Browse
                                    </Button>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>CSV Separator</Label>
                                    <Select
                                        value={settings.csvSeparator}
                                        onValueChange={(val) => setSettings(s => ({ ...s, csvSeparator: val }))}
                                    >
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value=",">Comma (,)</SelectItem>
                                            <SelectItem value=";">Semicolon (;)</SelectItem>
                                            <SelectItem value={"\t"}>Tab</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Max Leads per Scrape</Label>
                                    <Input
                                        type="number"
                                        value={settings.maxLeadsPerScrape}
                                        onChange={(e) => setSettings(s => ({ ...s, maxLeadsPerScrape: parseInt(e.target.value) || 200 }))}
                                        min={1} max={2000}
                                    />
                                </div>
                            </div>

                            <div className="w-1/2 space-y-2">
                                <Label>Delay Between Leads (ms)</Label>
                                <Input
                                    type="number"
                                    value={settings.delayBetweenLeads}
                                    onChange={(e) => setSettings(s => ({ ...s, delayBetweenLeads: parseInt(e.target.value) || 1500 }))}
                                    min={500} max={10000} step={100}
                                />
                                <p className="text-xs text-muted-foreground">1500–2500ms recommended. Lower = faster, higher = safer.</p>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Google Drive Integration */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Integrations</CardTitle>
                            <CardDescription>Connect external services to auto-save your leads.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="flex items-center justify-between p-4 border rounded-lg">
                                <div className="flex items-center gap-4">
                                    <div className={`p-2.5 rounded-full transition-colors ${driveStatus.connected ? 'bg-green-500/15' : 'bg-muted'}`}>
                                        <HardDrive className={`w-5 h-5 ${driveStatus.connected ? 'text-green-500' : 'text-muted-foreground'}`} />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-1.5">
                                            <p className="font-medium text-sm">Google Drive</p>
                                            {driveStatus.connected
                                                ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                                                : <XCircle className="h-3.5 w-3.5 text-muted-foreground/50" />
                                            }
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            {driveStatus.connected
                                                ? (driveStatus.email ? `Connected as ${driveStatus.email}` : "Connected ✓")
                                                : "Not connected"
                                            }
                                        </p>
                                    </div>
                                </div>
                                <Button
                                    variant={driveStatus.connected ? "outline" : "default"}
                                    size="sm"
                                    onClick={handleDriveToggle}
                                    disabled={driveLoading}
                                >
                                    {driveLoading
                                        ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> {driveStatus.connected ? "Disconnecting..." : "Connecting..."}</>
                                        : driveStatus.connected ? "Disconnect" : "Connect"
                                    }
                                </Button>
                            </div>

                            {/* Drive error message */}
                            {driveError && (
                                <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-500">
                                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                                    <div>
                                        <p className="font-medium">Connection Failed</p>
                                        <p className="text-xs mt-0.5 text-red-400">{driveError}</p>
                                    </div>
                                </div>
                            )}

                            {/* Setup hint when not connected */}
                            {!driveStatus.connected && !driveError && (
                                <p className="text-xs text-muted-foreground px-1">
                                    Requires a <code className="bg-muted px-1 py-0.5 rounded text-xs">credentials.json</code> from Google Cloud Console placed in the app's resources folder.
                                </p>
                            )}
                        </CardContent>
                    </Card>

                    <Separator />

                    <div className="flex justify-end gap-3 pb-8">
                        <Button variant="ghost" onClick={handleReset} disabled={resetting}>
                            {resetting
                                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Resetting...</>
                                : <><RotateCcw className="w-4 h-4 mr-2" /> Reset to Defaults</>
                            }
                        </Button>
                        <Button onClick={handleSave}>
                            {saved
                                ? <><CheckCircle2 className="w-4 h-4 mr-2 text-green-400" /> Saved!</>
                                : <><Save className="w-4 h-4 mr-2" /> Save Settings</>
                            }
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}
