using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

namespace NileUniversitySchedule
{
    static class Program
    {
        private static NotifyIcon trayIcon;
        private static ContextMenuStrip trayMenu;
        private static Process serverProcess;
        private static int serverPort = 3000;
        private static Mutex singleInstanceMutex;

        [STAThread]
        static void Main(string[] args)
        {
            // Ensure single instance of the launcher
            bool createdNew;
            singleInstanceMutex = new Mutex(true, "NileUniversityScheduleLauncherSingleInstance", out createdNew);

            if (!createdNew)
            {
                // Already running: just open browser and exit this second instance
                OpenBrowser("http://localhost:3000/");
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string appDir = AppDomain.CurrentDomain.BaseDirectory;
            Directory.SetCurrentDirectory(appDir);

            // 1. Verify Node.js
            if (!IsNodeInstalled())
            {
                MessageBox.Show(
                    "Node.js was not detected on your system.\nPlease install Node.js from https://nodejs.org/ to run the Nile University Timetable Server.",
                    "Node.js Required - Nile University Timetable",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning
                );
                return;
            }

            // 2. Start Node Server hidden
            StartServer(appDir);

            // 3. Setup System Tray Icon
            SetupTrayIcon();

            // 4. Wait for server readiness and open browser ONCE
            ThreadPool.QueueUserWorkItem(state =>
            {
                WaitForServerAndOpenBrowser();
            });

            // Run message loop for System Tray
            Application.Run();
        }

        private static bool IsNodeInstalled()
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("node", "-v")
                {
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                using (Process p = Process.Start(psi))
                {
                    p.WaitForExit(3000);
                    return p.ExitCode == 0;
                }
            }
            catch
            {
                return false;
            }
        }

        private static void StartServer(string appDir)
        {
            try
            {
                // Set environment variable so server.js does not open a second browser tab
                Environment.SetEnvironmentVariable("NO_BROWSER", "true");

                ProcessStartInfo psi = new ProcessStartInfo("node", "server.js")
                {
                    WorkingDirectory = appDir,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                    RedirectStandardError = true,
                    RedirectStandardOutput = true
                };

                psi.EnvironmentVariables["NO_BROWSER"] = "true";

                serverProcess = new Process { StartInfo = psi };
                serverProcess.EnableRaisingEvents = true;
                serverProcess.Exited += (s, e) =>
                {
                    // Server exited
                };

                serverProcess.Start();

                // Clean up process when main application exits
                AppDomain.CurrentDomain.ProcessExit += (s, e) => StopServer();
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Failed to start Nile University timetable background server:\n" + ex.Message,
                    "Server Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }

        private static void WaitForServerAndOpenBrowser()
        {
            bool ready = false;
            string url = "http://localhost:" + serverPort + "/";

            for (int i = 0; i < 20; i++)
            {
                Thread.Sleep(500);
                try
                {
                    HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
                    request.Timeout = 1000;
                    request.Method = "HEAD";
                    using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                    {
                        if ((int)response.StatusCode >= 200 && (int)response.StatusCode < 400)
                        {
                            ready = true;
                            break;
                        }
                    }
                }
                catch
                {
                    // Server not ready yet
                }
            }

            // Open browser exactly once
            OpenBrowser(url);

            if (trayIcon != null)
            {
                trayIcon.ShowBalloonTip(
                    3000,
                    "Nile University Timetable",
                    "Server running in background at http://localhost:3000\nClick this tray icon anytime to open or exit.",
                    ToolTipIcon.Info
                );
            }
        }

        private static void OpenBrowser(string url)
        {
            try
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch
            {
                try
                {
                    Process.Start("cmd.exe", "/c start " + url);
                }
                catch { }
            }
        }

        private static void SetupTrayIcon()
        {
            trayMenu = new ContextMenuStrip();

            ToolStripMenuItem openItem = new ToolStripMenuItem("🌐 Open Timetable (Browser)", null, (s, e) =>
            {
                OpenBrowser("http://localhost:" + serverPort + "/");
            });
            openItem.Font = new Font(openItem.Font, FontStyle.Bold);

            ToolStripMenuItem syncItem = new ToolStripMenuItem("🔄 Open Timetable & Force Refresh", null, (s, e) =>
            {
                OpenBrowser("http://localhost:" + serverPort + "/?refresh=true");
            });

            ToolStripMenuItem ipItem = new ToolStripMenuItem("📱 Phone / Wi-Fi Access Info", null, (s, e) =>
            {
                string localIp = GetLocalIPAddress();
                MessageBox.Show(
                    "To access on your phone or tablet connected to the same Wi-Fi:\n\n" +
                    "Open your phone browser and go to:\n" +
                    "http://" + localIp + ":" + serverPort + "\n\n" +
                    "Offline-first PWA caching is active on your device.",
                    "Mobile & Wi-Fi Access - Nile University",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
            });

            ToolStripSeparator sep = new ToolStripSeparator();

            ToolStripMenuItem exitItem = new ToolStripMenuItem("❌ Stop Server & Exit", null, (s, e) =>
            {
                StopServer();
                if (trayIcon != null)
                {
                    trayIcon.Visible = false;
                    trayIcon.Dispose();
                }
                Application.Exit();
            });

            trayMenu.Items.Add(openItem);
            trayMenu.Items.Add(syncItem);
            trayMenu.Items.Add(ipItem);
            trayMenu.Items.Add(sep);
            trayMenu.Items.Add(exitItem);

            // Load Nile University official icon
            Icon appIcon = null;
            string icoFile = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "app.ico");
            if (File.Exists(icoFile))
            {
                try
                {
                    appIcon = new Icon(icoFile);
                }
                catch { }
            }
            if (appIcon == null)
            {
                appIcon = CreateAppIcon();
            }

            trayIcon = new NotifyIcon
            {
                Text = "Nile University Smart Timetable (Active)",
                Icon = appIcon,
                ContextMenuStrip = trayMenu,
                Visible = true
            };

            trayIcon.DoubleClick += (s, e) =>
            {
                OpenBrowser("http://localhost:" + serverPort + "/");
            };
        }

        private static Icon CreateAppIcon()
        {
            try
            {
                Bitmap bmp = new Bitmap(32, 32);
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                    // Blue background
                    using (Brush b = new SolidBrush(Color.FromArgb(37, 99, 235)))
                    {
                        g.FillEllipse(b, 2, 2, 28, 28);
                    }
                    // Inner accent
                    using (Pen p = new Pen(Color.White, 2))
                    {
                        g.DrawEllipse(p, 4, 4, 24, 24);
                    }
                    // Text 'NU'
                    using (Font f = new Font("Arial", 11, FontStyle.Bold))
                    using (Brush textBrush = new SolidBrush(Color.White))
                    {
                        StringFormat sf = new StringFormat
                        {
                            Alignment = StringAlignment.Center,
                            LineAlignment = StringAlignment.Center
                        };
                        g.DrawString("NU", f, textBrush, new RectangleF(0, 0, 32, 32), sf);
                    }
                }
                return Icon.FromHandle(bmp.GetHicon());
            }
            catch
            {
                return SystemIcons.Application;
            }
        }

        private static string GetLocalIPAddress()
        {
            try
            {
                var host = Dns.GetHostEntry(Dns.GetHostName());
                foreach (var ip in host.AddressList)
                {
                    if (ip.AddressFamily == AddressFamily.InterNetwork && !ip.ToString().StartsWith("127."))
                    {
                        return ip.ToString();
                    }
                }
            }
            catch { }
            return "YOUR-PC-IP";
        }

        private static void StopServer()
        {
            try
            {
                if (serverProcess != null && !serverProcess.HasExited)
                {
                    serverProcess.Kill();
                    serverProcess.Dispose();
                    serverProcess = null;
                }
            }
            catch { }

            // Also kill any orphaned node server.js on port 3000 if needed
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", "/c for /f \"tokens=5\" %a in ('netstat -aon ^| findstr :3000') do taskkill /f /pid %a")
                {
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                    UseShellExecute = false
                };
                Process.Start(psi);
            }
            catch { }
        }
    }
}
