<p align="center">
  <img src="assets/artar-logo.svg" alt="ArtAR logo" width="80" height="80">
</p>

<h1 align="center">ArtAR</h1>

<p align="center">
  Preview artwork on your own walls with augmented reality.<br>
  Open ArtAR on your phone, choose a piece, and see how it fits your space.
</p>

<p align="center">
  <a href="https://artar-orthogonalinteractive.com/">https://artar-orthogonalinteractive.com/</a>
</p>

<p align="center">
  <a href="https://artar-orthogonalinteractive.com/">
    <img src="assets/artar-qr.png" alt="Scan to open ArtAR on your phone" width="240" height="240">
  </a>
</p>

<!-- version-history:start -->
## バージョン履歴

Web 版（[artar-orthogonalinteractive.com](https://artar-orthogonalinteractive.com/)）のフッターに表示されるバージョンの変更履歴です。

### v0.2.0（2026-10-10）

#### 追加

- 公開ページ・管理ページのフッターにバージョンを表示し、このバージョン履歴へリンク
- 専用ドメイン artar-orthogonalinteractive.com での配信
- Supabase 基盤：作家・作品・ギャラリーのスキーマ、行単位のアクセス制御、公開用 RPC、画像ストレージ、招待制ログイン
- 管理アプリ（`/admin/`）：ログイン・パスワード再設定・管理者の二段階認証（TOTP）・作家の招待と停止・プロフィール編集
- 管理アプリ：作品の画像アップロード、実寸・額縁の設定、編集・削除、管理者向けの全作品一覧
- 管理アプリ：ギャラリーの作成・編集・掲載作品・公開 URL と QR コード・URL の再発行
- メインページ（`/`）に全体公開の作品、ギャラリー URL（`/{galleryId}`）にそのギャラリーの作品を表示
- ギャラリー URL から iOS の App Clip・アプリへギャラリーを引き継いで起動
- デモギャラリーの登録スクリプト。PC では作品欄にそのページの QR コードを表示し、スマートフォンでの AR に誘導
- AR で実寸を確認：作品の目盛りと寸法ラベル、壁までの距離、「寸法」の表示切り替え
- AR 写真の保存（ギャラリー・作家・HP のクレジット入り）と、作品の購入ページへのリンク
- 作品セットと作家間の共有。ギャラリーに複数の作家の作品を掲載
- 作品・作品セットの期限付きグローバル公開と公開作家の一覧、管理アプリでの公開設定と購入 URL の入力
- 公開ページを「紹介・アーティスト・作品」の共通レイアウトに統一し、公開作品が無いときは AR の導線を出さない
- 利用状況と AR の成否の匿名イベント記録。個人を識別する情報は保存せず、90 日で削除
- iOS のネイティブ ARKit 実行環境（通常アプリ・App Clip）と、App Clip 起動用の `/arkit-test/`
- Android Chrome で WebXR（ARCore）による AR
- 認識した壁の強調表示、確定した壁を部屋の境界まで延長、別の壁への作品の移動

#### 変更

- AR の状態表示・操作ガイド・通知・ダイアログを整理し、文言を 1 か所に集約
- 通常表示の壁を 1 色にし、認識の詳細は `?debug=1` の診断パネルだけに表示
- 旧デモの端末内管理画面・JSON 入出力・`?collection=` 指定・共有 QR を廃止し、作品データを Supabase から読み込む方式に移行
- 同梱のデモ作品を撤去し、接続先が未設定のときはその旨を表示
- ソースコード全体を TypeScript（strict）に移行

#### セキュリティ

- 本番ビルドの公開ページと管理アプリに Content Security Policy を設定
- 8th Wall エンジンをサブリソース完全性（SRI）で固定し、作品画像の別オリジン参照と過大な画像を拒否
- iOS の Web ビューを App-Bound Domains に限定し、画面遷移時に ARKit セッションを停止
- GitHub Actions をコミット SHA で固定し、秘密情報の参照範囲を必要な手順に限定。Dependabot を有効化

### v0.1.0（2026-09-22）

#### 追加

- 額装アートを実寸で壁に飾る WebAR デモ（Vue 3・Vite・Three.js、8th Wall によるカメラ空間追跡）
- 作品寸法・マット・額縁を含む 3D モデル、フレームの切り替え、PC 向けの 3D 部屋プレビュー
- 空間特徴点からの壁の推定、壁をタップして配置・ドラッグで移動・1 cm 単位の微調整、既知の距離による実寸補正
- ブラウザ内の管理デモ（作品・コレクションの編集、JSON 入出力）と、ゲスト向けのコレクション共有 URL・QR コード
- GitHub Pages への静的配信
<!-- version-history:end -->
