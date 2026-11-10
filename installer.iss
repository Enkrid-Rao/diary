; Diary 安装包脚本（Inno Setup 6）
; 编译：ISCC.exe installer.iss
; 产物：dist\Diary-<版本>-win64-setup.exe

#define AppName "Diary"
; 版本号由 build_release.py 写进 build\version.iss，避免两处手改
#if FileExists(AddBackslash(SourcePath) + "build\version.iss")
  #include AddBackslash(SourcePath) + "build\version.iss"
#else
  #define AppVersion "0.0.0"
#endif
#define AppPublisher "Enkrid-Rao"
#define AppURL "https://github.com/Enkrid-Rao/diary"
#define AppExe "Diary.exe"
#define SourceDir "dist\Diary"

[Setup]
AppId={{8E4C1F62-7B3D-4A55-9C1E-5A7D3B9E2C41}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}/issues
AppUpdatesURL={#AppURL}/releases
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; 默认装到 Program Files；想要免管理员可以选「只为我安装」，此时会落到
; %LOCALAPPDATA%\Programs\Diary。日记与设置始终在用户目录，跟安装位置无关。
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog commandline
OutputDir=dist
OutputBaseFilename=Diary-{#AppVersion}-win64-setup
SetupIconFile=app.ico
UninstallDisplayIcon={app}\{#AppExe}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
LicenseFile=LICENSE
MinVersion=10.0

[Languages]
Name: "chinesesimplified"; MessagesFile: "lang\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务："; Flags: unchecked

[Files]
Source: "{#SourceDir}\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\_internal\*"; DestDir: "{app}\_internal"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceDir}\LICENSE"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{group}\卸载 {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "启动 {#AppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; 只清程序目录，日记与设置在 %APPDATA%\Diary 和「文档\Diary」，卸载不动
Type: filesandordirs; Name: "{app}"
