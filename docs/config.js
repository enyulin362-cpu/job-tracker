/* 選用的雲端同步設定。url 與 anonKey 都留空時，網站只使用瀏覽器本機儲存。
   請只填 Project URL 與 anon / publishable key。不要填 service_role 或 sb_secret_ key。
   這份檔案會跟著網站公開，金鑰本來就會出現在瀏覽器裡；資料靠資料庫的 Row Level Security 保護。 */
window.JOB_TRACKER_SUPABASE = {
  url: "https://vmyitibdkkguzgqwsrbc.supabase.co",
  anonKey: "sb_publishable_5bRHv6VKJ04aJ_3fLTatgw_0fJxoRUZ"
};
