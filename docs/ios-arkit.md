# iOS ARKit runtime（作業ブランチ）

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
   現在の既定URLはmasterの公開サイトなので、そのままでは新しいブリッジコードを
   読み込めません。masterへの公開はこの作業に含めていません。
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

この環境ではXcodeビルド・署名・実機の位置精度は検証できていません。

## 依存パッケージを取得できない環境での検証

`npm run test:arkit-runtime`はNode.jsの標準機能だけでブリッジの起動・終了・
中断・通信失敗・描画失敗・不正データ・画面回転・経路選択を検証します。
幾何変換はスタブなので、この検証だけでは実際の壁形状やWebGL描画を保証しません。
依存パッケージが利用できる環境では、必ず`npm ci`・`npm test`・`npm run build`を実行し、
続いてXcodeと実機で確認してください。
