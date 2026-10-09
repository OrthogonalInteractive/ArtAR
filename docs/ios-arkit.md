# iOS ARKit runtime

SafariのJavaScriptだけでARKitを動かすことはできません。このブランチでは、
ARKitを動かすネイティブ実行環境（通常アプリ／App Clip）にArtARを読み込みます。
通常のSafariは既存の8th Wall、Androidは既存のWebXRを使います。
iOSでWebXR APIを提供する別の実行環境ではWebXRを優先しますが、
`local`・`hit-test`・`dom-overlay`の対応が必要です。

## 実装

- `ios/ArtARRuntime/ArtARApp.swift`: ARSCNViewがARKitのカメラ表示を担当。
  透明なWKWebViewにVueとThree.jsを表示します。
- `src/ar/arkit.js`: 姿勢・投影行列・観測ポリゴンを受け取り、既存の壁／床・天井
  判定、3回の安定確認、配置制約と操作に渡します。
- ネイティブの`artarAR`ハンドラがある場合だけARKitへ分岐します。
  URLパラメータだけではSafariのARKitを有効にできません。
- ネイティブ側からカメラ画像・特徴点をJavaScriptやサーバーへ送信しません。
  行列と平面境界はメートル単位。30Hzで送信します。
- 追跡喪失中は作品を非表示にし、背景移行から復帰する際は座標と配置をリセット。
  AR終了でカメラセッションを停止します。
- この初期版はLiDAR深度、画像認識、オクルージョンを提供しません。
  ARKitの面分類が不明な場合は、既存の幾何判定を使用します。

## Macでビルド

Xcode、XcodeGen、カメラ付きARKit対応のiPhone／iPad、Appleの署名設定が必要です。

```sh
cd ios
xcodegen generate
open ArtAR.xcodeproj
```

1. `project.yml`の`ARTAR_PAGE_URL`を、このブランチのWebビルドを公開したHTTPS URLへ変更。
   既定URLはmasterのGitHub Pagesです。Web側のARKit対応コードを公開した後に利用します。
2. Bundle IdentifierとSigning Teamを自分の設定に変更。
3. 最初は`ArtAR`スキームで実機にインストールして確認。
4. ページの「カメラを開始」でARKitが起動します。iOSシミュレータでは検証不可。

## App Clipとして配布

`ArtARClip`ターゲットを用意していますが、公開・署名・起動ドメインの設定は未完了です。
App Store Connectで親アプリとApp Clipの登録、App Clip Experience、署名・Provisioning、
配布サイズの確認が必要です。自分で管理できるドメインにapple-app-site-associationを
配置し、Associated Domainsの`appclips:`を設定してください。
このブランチは起動リンクやSafariのSmart App Bannerを自動追加しません。
初期版はInfo.plistの固定URLを読み込むため、コレクション別のApp Clip起動URL引き継ぎは
まだ対応していません。対象を限定する場合はそのURLを`ARTAR_PAGE_URL`に設定してください。

## 実機確認

- カメラ許可／拒否、初回起動とAR終了後の再開始。
- 縦持ち・横持ちでカメラと額縁の位置が一致すること。
- 垂直壁の認識、床を配置対象にしないこと、実寸、壁端・角の配置制約。
- タップ配置、ドラッグ、作品／額縁の切り替え。
- 背景移行、ARKit中断、復帰時の古い壁／作品の破棄。
- 同じ端末の通常Safariが8th Wallに戻ること、AndroidがWebXRのままであること。

実機での位置精度・署名・App Clip公開は自動ビルドとは別に確認が必要です。

## 依存パッケージを取得できない環境での検証

`npm run test:arkit-runtime`はNode.jsの標準機能だけでブリッジの起動・終了・
中断・通信失敗・描画失敗・不正データ・画面回転・経路選択を検証します。
幾何変換はスタブなので、この検証だけでは実際の壁形状やWebGL描画を保証しません。
依存パッケージが利用できる環境では、必ず`npm ci`・`npm test`・`npm run build`を実行し、
続いてXcodeと実機で確認してください。

## クラウドでのビルド・公開

`.github/workflows/validate.yml`で、LinuxのWebテスト／ビルドとmacOSのXcodeビルドを
実行します。CodexのLinux環境自体ではXcodeは動きませんが、GitHub ActionsのmacOS
ランナーで`xcodegen`と`xcodebuild`を実行できます。

- Web: `npm ci`、Vitest、ブリッジの独立テスト、Viteビルド。
- iOS: 親アプリと埋め込みApp ClipをReleaseで署名なしビルド。
- 成功時: ActionsのArtifactsから`web-dist`と`ios-unsigned-app`を取得できます。
- `ios-unsigned-app`はコンパイル確認用で、iPhoneへインストールできる署名済みIPAではありません。
- Web公開: masterへ反映すると既存の`deploy.yml`がGitHub Pagesへ公開します。

TestFlightやApp Clipを配布するにはApple DeveloperのTeam、App Store Connectのアプリ、
Bundle ID、証明書・Provisioning Profile、または認証付き自動署名を設定する必要があります。
署名情報はGitHub Secretsで管理し、チャットやGitへ秘密鍵を保存しないでください。
GitHub Pagesの`/ArtAR/`配下だけでは、App Clip起動用ドメイン直下の
`/.well-known/apple-app-site-association`を管理できません。配布には管理可能な独自ドメインか、
Appleの起動URLを含めたApp Clip Experienceの設定を別途決める必要があります。

## Team 85JY63L889のテスト版

- 通常版: https://orthogonalinteractive.github.io/ArtAR/
- ARKit専用テスト版: https://orthogonalinteractive.github.io/ArtAR/arkit-test/
- iOSの既定の読み込み先はテスト版です。
- `VITE_REQUIRE_ARKIT=true`のWebビルドはネイティブブリッジを必須とし、
  Safariで8th Wallを起動しません。URLだけでSafariがARKit対応になるわけではありません。

### TestFlightの準備

Apple Developer / App Store ConnectのTeamは`85JY63L889`を使用します。
親アプリ`com.orthogonalinteractive.artar`とApp Clip
`com.orthogonalinteractive.artar.Clip`を同じTeamで登録してください。
App Store Connectの「マイApp」に親アプリのレコードを作成し、必要な契約を有効にします。
親アプリにはAssociated App Clip App Identifiers、App ClipにはParent Application
Identifiersのエンタイトルメントを設定しています。

App Store Connectの「ユーザとアクセス → 統合 → App Store Connect API」で、
証明書・プロファイルへのアクセスとクラウド署名を利用できるTeam APIキーを作成します。
権限が不足する場合は管理者に設定を依頼してください。APIキーはTeam IDとは別の認証情報です。

GitHubのSettings → Secrets and variables → Actionsへ次のRepository secretsを登録します。

| Secret | 内容 |
|---|---|
| APP_STORE_CONNECT_KEY_ID | APIキーのKey ID |
| APP_STORE_CONNECT_ISSUER_ID | Team APIキーのIssuer ID |
| APP_STORE_CONNECT_PRIVATE_KEY | ダウンロードした.p8の全文（改行を含む） |

.p8はGitやチャットに保存しないでください。この接続ではSecretsの値は読み取りません。
自動署名時にApple側の証明書・Provisioning設定が不足している場合、ワークフローは失敗し、
Appleのエラーを表示します。Team IDを設定しただけで署名が完了したことにはなりません。

登録後、Actions → 「Upload ARKit test build to TestFlight」→ Run workflow → masterを選択。
macOSで自動署名して親アプリとApp ClipをArchiveし、App Store Connectへアップロードします。
APIキーは一時ファイルに保存し、実行終了時に削除します。公開App Storeへの審査提出は行いません。

Appleの処理が完了した後、App Store ConnectのTestFlightでテスト端末のユーザーを追加し、
App Clipのテスト用ExperienceにテストURLを登録してください。
まず内部テスターで検証するのが簡単です。外部テスターにはベータ審査が必要になる場合があります。
実機のTestFlightからApp Clipを起動し、「カメラを開始」でARKitの壁検知を確認します。

- [Apple: App ClipのTestFlightテスト](https://developer.apple.com/help/app-store-connect/test-a-beta-version/test-an-app-clip-experience)
- [Apple: Xcodeのクラウド署名](https://developer.apple.com/videos/play/wwdc2021/10204/)
