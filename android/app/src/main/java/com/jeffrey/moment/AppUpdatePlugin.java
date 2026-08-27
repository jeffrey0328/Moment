package com.jeffrey.moment;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;

@CapacitorPlugin(name = "MomentAppUpdate")
public class AppUpdatePlugin extends Plugin {
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url", "");
        if (!isHttps(url)) {
            call.reject("更新地址无效");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            startActivityForResult(call, intent, "onInstallPermission");
            return;
        }
        startDownload(call, url);
    }

    @ActivityCallback
    private void onInstallPermission(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
            call.reject("请允许拾光记安装未知应用，才能在应用内更新");
            return;
        }
        startDownload(call, call.getString("url", ""));
    }

    private void startDownload(PluginCall call, String url) {
        new Thread(() -> {
            try {
                File apk = download(url);
                getActivity().runOnUiThread(() -> {
                    try {
                        install(apk);
                        call.resolve();
                    } catch (Exception error) {
                        call.reject(error.getMessage());
                    }
                });
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "下载更新失败" : error.getMessage());
            }
        }).start();
    }

    private File download(String spec) throws Exception {
        HttpURLConnection connection = open(spec, 0);
        File apk = new File(getContext().getCacheDir(), "moment-update.apk");
        long total = connection.getContentLengthLong();
        long received = 0;
        int lastPercent = -1;
        try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(apk)) {
            byte[] buffer = new byte[16 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
                received += read;
                if (total > 0) {
                    int percent = (int) Math.min(99, (received * 100) / total);
                    if (percent != lastPercent) {
                        lastPercent = percent;
                        emitProgress(percent);
                    }
                }
            }
        } finally {
            connection.disconnect();
        }
        emitProgress(100);
        return apk;
    }

    private HttpURLConnection open(String spec, int hops) throws Exception {
        if (hops > 8) throw new Exception("更新地址跳转过多");
        if (!isHttps(spec)) throw new Exception("更新地址必须使用 HTTPS");
        URL url = URI.create(spec).toURL();
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(20000);
        connection.setReadTimeout(180000);
        connection.setRequestProperty("User-Agent", "ShiguangNotes-Updater");
        connection.setRequestProperty("Accept", "*/*");
        int code = connection.getResponseCode();
        if (code >= 300 && code < 400) {
            String next = connection.getHeaderField("Location");
            connection.disconnect();
            if (next == null || next.isEmpty()) throw new Exception("更新地址无效");
            URL resolved = new URL(url, next);
            return open(resolved.toString(), hops + 1);
        }
        if (code >= 400) {
            connection.disconnect();
            throw new Exception("下载失败（" + code + "）");
        }
        return connection;
    }

    private void install(File apk) {
        Uri uri = FileProvider.getUriForFile(
            getContext(),
            getContext().getPackageName() + ".fileprovider",
            apk
        );
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getActivity().startActivity(intent);
    }

    private void emitProgress(int percent) {
        JSObject data = new JSObject();
        data.put("percent", percent);
        notifyListeners("progress", data);
    }

    private boolean isHttps(String spec) {
        return spec != null && spec.startsWith("https://");
    }
}
