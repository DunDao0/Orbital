using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class OrbitalSetup
{
    internal static readonly string AppName = "Orbital " + PackageInfo.Version;
    internal static readonly string RegistryPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Orbital-" + PackageInfo.Version;
    internal static readonly string MenuPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), AppName);
    internal static string DefaultPath { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Orbital", PackageInfo.Version); } }

    [STAThread]
    private static int Main(string[] args)
    {
        System.Threading.Mutex installationMutex = null;
        bool ownsMutex = false;
        try
        {
            installationMutex = new System.Threading.Mutex(true, @"Local\Orbital.Setup." + PackageInfo.Version, out ownsMutex);
            if (!ownsMutex) throw new IOException("Já existe um assistente desta versão aberto. Conclua ou feche essa instalação primeiro.");
            if (!Environment.Is64BitOperatingSystem || Environment.OSVersion.Version.Major < 10 ||
                String.Equals(Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE"), "ARM64", StringComparison.OrdinalIgnoreCase) ||
                String.Equals(Environment.GetEnvironmentVariable("PROCESSOR_ARCHITEW6432"), "ARM64", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("O Orbital requer Windows 10/11 de 64 bits, em um computador Intel ou AMD.");
            if (args.Length > 0)
            {
                if (args.Length != 2 || args[0] != "--install-dir")
                    throw new ArgumentException("Uso para instalação sem interface: --install-dir <pasta vazia>. Não abre o Orbital nem cria atalho na área de trabalho.");
                Install(args[1], false, delegate(string message) { });
                return 0;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupWindow());
            return 0;
        }
        catch (Exception error)
        {
            if (args.Length == 0) MessageBox.Show(error.Message, "Instalação do Orbital", MessageBoxButtons.OK, MessageBoxIcon.Error);
            else File.WriteAllText(Path.Combine(Path.GetTempPath(), "Orbital-setup-last-error.txt"), error.ToString());
            return 1;
        }
        finally
        {
            if (installationMutex != null)
            {
                if (ownsMutex) installationMutex.ReleaseMutex();
                installationMutex.Dispose();
            }
        }
    }

    internal static string NormalizeDestination(string value)
    {
        if (!Path.IsPathRooted(value)) throw new IOException("Escolha uma pasta com caminho completo.");
        string root = Path.GetFullPath(value).TrimEnd(Path.DirectorySeparatorChar);
        if (root.StartsWith(@"\\") || root.IndexOf('"') >= 0 || root.IndexOf('\n') >= 0 || root.IndexOf('\r') >= 0 || root.Length < 5 || root.Length > 150)
            throw new IOException("Escolha uma pasta local com um caminho de até 150 caracteres.");
        RejectLinks(root);
        if (File.Exists(root) || (Directory.Exists(root) && Directory.EnumerateFileSystemEntries(root).Any()))
            throw new IOException("A pasta escolhida já contém arquivos. Escolha uma pasta vazia para preservar a instalação e os dados existentes.");
        return root;
    }

    private static void RejectLinks(string path)
    {
        for (string current = path; !String.IsNullOrEmpty(current); current = Path.GetDirectoryName(current))
            if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                throw new IOException("A pasta de instalação não pode usar links ou junções: " + current);
    }

    private static string Hash(Stream stream)
    {
        using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
    }

    private static string SafePath(string root, string relative)
    {
        if (String.IsNullOrEmpty(relative) || relative.Contains("\\") || relative.Contains(":") || relative.Split('/').Any(p => p == ".." || p == "." || p == ""))
            throw new IOException("Caminho inválido no pacote.");
        string result = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
        if (!result.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("Arquivo fora da pasta de instalação.");
        return result;
    }

    private static void Shortcut(string path, string script, string root)
    {
        dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
        dynamic link = shell.CreateShortcut(path);
        link.TargetPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");
        link.Arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File \"" + script + "\"";
        link.WorkingDirectory = root;
        link.Description = AppName;
        link.Save();
        System.Runtime.InteropServices.Marshal.FinalReleaseComObject(link);
        System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell);
    }

    internal static void Install(string destination, bool desktop, Action<string> progress)
    {
        string root = NormalizeDestination(destination);
        // A registered version is never silently redirected or overwritten.
        using (var existing = Registry.CurrentUser.OpenSubKey(RegistryPath))
            if (existing != null) throw new IOException("Esta versão já está instalada. Abra-a pelo menu Iniciar ou desinstale-a antes de instalar novamente.");
        if (Directory.Exists(MenuPath)) throw new IOException("Já existe uma pasta de atalhos para esta versão no menu Iniciar.");
        string desktopLink = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), AppName + ".lnk");
        if (desktop && File.Exists(desktopLink)) throw new IOException("Já existe um atalho com esse nome na área de trabalho.");
        bool createdRoot = false;
        bool createdMenu = false;
        bool createdRegistry = false;
        bool createdDesktop = false;
        var createdFiles = new List<string>();
        var createdDirectories = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            progress("Verificando a integridade dos arquivos...");
            using (var payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("Orbital.Payload.zip"))
            {
                if (payload == null || Hash(payload) != PackageInfo.Sha256) throw new IOException("O pacote está incompleto ou foi alterado. Baixe o instalador novamente.");
                payload.Position = 0;
                using (var zip = new ZipArchive(payload, ZipArchiveMode.Read))
                {
                    var serializer = new JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024 };
                    var manifestEntry = zip.GetEntry("SOURCE-MANIFEST.json");
                    if (manifestEntry == null) throw new IOException("Manifesto ausente.");
                    Dictionary<string, object> manifest;
                    using (var reader = new StreamReader(manifestEntry.Open())) manifest = serializer.Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
                    var files = ((System.Collections.ArrayList)manifest["files"]).Cast<Dictionary<string, object>>().ToDictionary(f => (string)f["path"], f => (string)f["sha256"], StringComparer.OrdinalIgnoreCase);
                    if (zip.Entries.Count != files.Count + 1 || zip.Entries.Select(e => e.FullName).Distinct(StringComparer.OrdinalIgnoreCase).Count() != zip.Entries.Count)
                        throw new IOException("Lista de arquivos inconsistente.");
                    foreach (var entry in zip.Entries)
                    {
                        SafePath(root, entry.FullName);
                        if (entry.FullName == "SOURCE-MANIFEST.json") continue;
                        string expected;
                        using (var stream = entry.Open())
                            if (!files.TryGetValue(entry.FullName, out expected) || Hash(stream) != expected) throw new IOException("Falha de integridade: " + entry.FullName);
                    }
                    if (!Directory.Exists(root)) { Directory.CreateDirectory(root); createdRoot = true; }
                    progress("Instalando o Orbital...");
                    foreach (var entry in zip.Entries)
                    {
                        string path = SafePath(root, entry.FullName);
                        string parent = Path.GetDirectoryName(path);
                        for (string dir = parent; dir != root && !Directory.Exists(dir); dir = Path.GetDirectoryName(dir)) createdDirectories.Add(dir);
                        Directory.CreateDirectory(parent);
                        RejectLinks(path);
                        // CreateNew prevents races from overwriting unrelated files.
                        using (var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write))
                        {
                            createdFiles.Add(path);
                            using (var input = entry.Open()) input.CopyTo(output);
                        }
                    }
                    string marker = SafePath(root, "INSTALLATION.json");
                    using (var writer = new StreamWriter(new FileStream(marker, FileMode.CreateNew, FileAccess.Write), new UTF8Encoding(false)))
                    {
                        createdFiles.Add(marker);
                        writer.Write(serializer.Serialize(new { schema = 1, product = "Orbital", version = PackageInfo.Version, root = root, manifest_sha256 = ManifestHash(root), desktop = desktop }));
                    }
                }
            }
            progress("Criando os atalhos...");
            Directory.CreateDirectory(MenuPath);
            createdMenu = true;
            Shortcut(Path.Combine(MenuPath, "Abrir Orbital.lnk"), Path.Combine(root, @"scripts\windows\Open-Orbital.ps1"), root);
            Shortcut(Path.Combine(MenuPath, "Parar Orbital.lnk"), Path.Combine(root, @"scripts\windows\Stop-Orbital.ps1"), root);
            Shortcut(Path.Combine(MenuPath, "Desinstalar Orbital.lnk"), Path.Combine(root, @"scripts\windows\Uninstall-Orbital.ps1"), root);
            if (desktop) { Shortcut(desktopLink, Path.Combine(root, @"scripts\windows\Open-Orbital.ps1"), root); createdDesktop = true; }
            using (var key = Registry.CurrentUser.CreateSubKey(RegistryPath))
            {
                createdRegistry = true;
                string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");
                key.SetValue("DisplayName", AppName);
                key.SetValue("DisplayVersion", PackageInfo.Version);
                key.SetValue("Publisher", "DunDao0");
                key.SetValue("InstallLocation", root);
                key.SetValue("URLInfoAbout", "https://github.com/DunDao0/Orbital");
                key.SetValue("UninstallString", "\"" + powershell + "\" -NoLogo -NoProfile -ExecutionPolicy Bypass -File \"" + Path.Combine(root, @"scripts\windows\Uninstall-Orbital.ps1") + "\"");
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        }
        catch
        {
            // Roll back only entries created by this attempt, never a recursive folder deletion.
            if (createdRegistry) Registry.CurrentUser.DeleteSubKeyTree(RegistryPath, false);
            if (createdDesktop && File.Exists(desktopLink)) File.Delete(desktopLink);
            if (createdMenu)
            {
                foreach (string name in new[] { "Abrir Orbital.lnk", "Parar Orbital.lnk", "Desinstalar Orbital.lnk" })
                    if (File.Exists(Path.Combine(MenuPath, name))) File.Delete(Path.Combine(MenuPath, name));
                if (!Directory.EnumerateFileSystemEntries(MenuPath).Any()) Directory.Delete(MenuPath);
            }
            foreach (string path in createdFiles.AsEnumerable().Reverse()) if (File.Exists(path)) File.Delete(path);
            foreach (string dir in createdDirectories.OrderByDescending(p => p.Length)) if (Directory.Exists(dir) && !Directory.EnumerateFileSystemEntries(dir).Any()) Directory.Delete(dir);
            if (createdRoot && Directory.Exists(root) && !Directory.EnumerateFileSystemEntries(root).Any()) Directory.Delete(root);
            throw;
        }
    }

    private static string ManifestHash(string root)
    {
        using (var stream = File.OpenRead(Path.Combine(root, "SOURCE-MANIFEST.json"))) return Hash(stream);
    }

    internal static void Launch(string root)
    {
        Process.Start(new ProcessStartInfo {
            FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"),
            Arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File \"" + Path.Combine(root, @"scripts\windows\Open-Orbital.ps1") + "\"",
            WorkingDirectory = root, UseShellExecute = true
        });
    }
}

internal sealed class SetupWindow : Form
{
    private readonly TextBox folder = new TextBox();
    private readonly CheckBox desktop = new CheckBox();
    private readonly CheckBox launch = new CheckBox();
    private readonly Label status = new Label();
    private readonly Button install = new Button();
    private readonly Button browse = new Button();
    private bool busy;
    private bool finished;

    internal SetupWindow()
    {
        Text = "Instalar " + OrbitalSetup.AppName;
        Font = new Font("Segoe UI", 10);
        ClientSize = new Size(620, 390);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        Controls.Add(new Label { Text = "Orbital", Font = new Font("Segoe UI", 24, FontStyle.Bold), Location = new Point(28, 22), AutoSize = true });
        Controls.Add(new Label { Text = "Explore o Sistema Solar no seu computador.", Location = new Point(30, 78), AutoSize = true });
        Controls.Add(new Label { Text = "Na primeira abertura, mantenha a internet conectada. O Orbital prepara\nPython, Node.js e os dados automaticamente. Isso pode levar alguns minutos.", Location = new Point(30, 112), Size = new Size(560, 52) });
        Controls.Add(new Label { Text = "Instalar nesta pasta:", Location = new Point(30, 180), AutoSize = true });
        folder.SetBounds(30, 207, 447, 28); folder.Text = OrbitalSetup.DefaultPath; Controls.Add(folder);
        browse.Text = "Escolher..."; browse.SetBounds(487, 205, 100, 31); Controls.Add(browse);
        browse.Click += delegate { using (var dialog = new FolderBrowserDialog { Description = "Escolha uma pasta vazia para o Orbital", SelectedPath = folder.Text }) if (dialog.ShowDialog(this) == DialogResult.OK) folder.Text = dialog.SelectedPath; };
        desktop.Text = "Criar atalho na área de trabalho"; desktop.Checked = true; desktop.SetBounds(30, 251, 400, 28); Controls.Add(desktop);
        launch.Text = "Abrir o Orbital após a instalação"; launch.Checked = true; launch.SetBounds(30, 281, 400, 28); Controls.Add(launch);
        status.SetBounds(30, 331, 430, 50); Controls.Add(status);
        install.Text = "Instalar"; install.SetBounds(477, 332, 110, 36); Controls.Add(install); AcceptButton = install;
        install.Click += async delegate
        {
            if (finished) { Close(); return; }
            string destination = folder.Text;
            bool shortcut = desktop.Checked;
            busy = true; install.Enabled = browse.Enabled = folder.Enabled = desktop.Enabled = launch.Enabled = false;
            try
            {
                await Task.Run(() => OrbitalSetup.Install(destination, shortcut, message => BeginInvoke(new Action(() => status.Text = message))));
                finished = true; status.Text = "Instalado! Use o atalho Orbital no menu Iniciar."; install.Text = "Concluir";
                if (launch.Checked) OrbitalSetup.Launch(Path.GetFullPath(destination));
            }
            catch (Exception error)
            {
                status.Text = finished ? "Instalado. Abra pelo menu Iniciar." : "A instalação não foi concluída.";
                MessageBox.Show(this, error.Message, "Orbital", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally { busy = false; install.Enabled = true; if (!finished) browse.Enabled = folder.Enabled = desktop.Enabled = launch.Enabled = true; }
        };
        FormClosing += delegate(object sender, FormClosingEventArgs e) { if (busy) e.Cancel = true; };
    }
}
