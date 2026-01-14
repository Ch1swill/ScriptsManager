import asyncio
import httpx
import logging
from . import scheduler, models, database

logger = logging.getLogger(__name__)

class TelegramBot:
    def __init__(self, token, chat_id, proxy=None):
        self.token = token
        self.chat_id = chat_id
        self.proxy = proxy
        self.base_url = f"https://api.telegram.org/bot{token}"
        self.offset = 0
        self.is_running = False

    async def get_updates(self):
        url = f"{self.base_url}/getUpdates"
        params = {"offset": self.offset, "timeout": 30}
        proxies = self.proxy if self.proxy else None
        async with httpx.AsyncClient(proxy=proxies, timeout=40) as client:
            try:
                resp = await client.get(url, params=params)
                if resp.status_code == 200:
                    return resp.json()
                elif resp.status_code == 409:
                    return {"conflict": True}
                else:
                    logger.warning(f"TG Polling failed: {resp.status_code}")
                    return None
            except Exception as e:
                logger.error(f"TG Polling Error: {e}")
                return None

    async def send_message(self, text, reply_markup=None):
        url = f"{self.base_url}/sendMessage"
        data = {"chat_id": self.chat_id, "text": text}
        if reply_markup:
            data["reply_markup"] = reply_markup

        proxies = self.proxy if self.proxy else None
        async with httpx.AsyncClient(proxy=proxies, timeout=10.0) as client:
            try:
                await client.post(url, json=data)
            except asyncio.TimeoutError:
                logger.error(f"TG Send timeout: message not delivered")
            except Exception as e:
                logger.error(f"TG Send Error: {e}")

    async def handle_update(self, update):
        update_id = update.get("update_id")
        self.offset = update_id + 1

        message = update.get("message")
        callback_query = update.get("callback_query")

        from_id = None
        try:
            if message:
                from_id = int(message.get("chat", {}).get("id"))
            elif callback_query:
                from_id = int(callback_query.get("message", {}).get("chat", {}).get("id"))
        except (TypeError, ValueError):
            logger.warning(f"Invalid chat_id in update: {update}")
            return

        # 将self.chat_id转换为int进行比较
        try:
            chat_id_int = int(self.chat_id)
        except (TypeError, ValueError):
            logger.error(f"Invalid chat_id configured: {self.chat_id}")
            return

        if from_id != chat_id_int:
            return

        if message:
            text = message.get("text", "")
            if text in ["/menu", "/start", "📂 脚本管理"]:
                if text == "/start":
                    await self.send_message(
                        "👋 *欢迎使用 ScriptsManager！*\n\n点击左下角菜单或发送 /menu 开始管理您的脚本。", 
                        reply_markup={"remove_keyboard": True}
                    )
                await self.show_scripts_menu()

        if callback_query:
            data = callback_query.get("data")
            await self.handle_callback(data)

    async def show_scripts_menu(self):
        db = database.SessionLocal()
        try:
            scripts = db.query(models.Script).all()
        finally:
            db.close()

        keyboard = []
        keyboard.append([{"text": "🏥 立即执行全系统体检", "callback_data": "manual_health_check"}])

        if not scripts:
            await self.send_message("📭 目前没有任何脚本文件。", {"inline_keyboard": keyboard})
            return

        for s in scripts:
            status = "🟢" if s.last_status == "running" else "⚫"
            keyboard.append([{"text": f"{status} {s.name}", "callback_data": f"menu_{s.id}"}])

        await self.send_message("📂 *请选择需要管理的脚本：*", {"inline_keyboard": keyboard})

    async def handle_callback(self, data):
        try:
            if data == "manual_health_check":
                await self.run_health_check()
            elif data.startswith("menu_"):
                try:
                    script_id = int(data.split("_")[1])
                    await self.show_script_actions(script_id)
                except (IndexError, ValueError):
                    logger.error(f"Invalid menu callback data: {data}")
                    await self.send_message("❌ 无效的请求，请返回重试。")
            elif data.startswith("run_"):
                try:
                    script_id = int(data.split("_")[1])
                    await self.run_script_bg(script_id)
                except (IndexError, ValueError):
                    logger.error(f"Invalid run callback data: {data}")
                    await self.send_message("❌ 无效的请求，请返回重试。")
            elif data.startswith("stop_"):
                try:
                    script_id = int(data.split("_")[1])
                    await self.stop_script_bg(script_id)
                except (IndexError, ValueError):
                    logger.error(f"Invalid stop callback data: {data}")
                    await self.send_message("❌ 无效的请求，请返回重试。")
            elif data.startswith("log_"):
                try:
                    script_id = int(data.split("_")[1])
                    await self.show_script_log(script_id)
                except (IndexError, ValueError):
                    logger.error(f"Invalid log callback data: {data}")
                    await self.send_message("❌ 无效的请求，请返回重试。")
            elif data == "back_list":
                await self.show_scripts_menu()
            else:
                logger.warning(f"Unknown callback data: {data}")
        except Exception as e:
            logger.error(f"Error in handle_callback: {e}")
            await self.send_message("❌ 处理请求时出错，请稍后重试。")

    async def show_script_actions(self, script_id):
        db = database.SessionLocal()
        try:
            script = db.query(models.Script).filter(models.Script.id == script_id).first()
        finally:
            db.close()

        if not script:
            logger.warning(f"Script {script_id} not found in database")
            await self.send_message("❌ 脚本不存在。")
            return

        keyboard = [
            [
                {"text": "▶️ 启动脚本", "callback_data": f"run_{script.id}"},
                {"text": "⏹️ 终止运行", "callback_data": f"stop_{script.id}"}
            ],
            [{"text": "📄 查看最近 50 条日志", "callback_data": f"log_{script.id}"}],
            [{"text": "🔙 返回脚本列表", "callback_data": "back_list"}]
        ]
        await self.send_message(f"🛠 *正在管理：*{script.name}\n路径：`{script.path}`", {"inline_keyboard": keyboard})

    async def run_script_bg(self, script_id):
        db = database.SessionLocal()
        try:
            script = db.query(models.Script).filter(models.Script.id == script_id).first()
            if not script:
                await self.send_message(f"❌ 脚本 (ID: {script_id}) 不存在。")
                return

            is_daemon = (script.cron == "@daemon")
            asyncio.create_task(scheduler.run_script(
                script.id, script.path, script.name,
                self.token, self.chat_id, script.arguments, is_daemon
            ))
            await self.send_message(f"✅ 已发送启动指令：*{script.name}*")
        except Exception as e:
            logger.error(f"Error in run_script_bg: {e}")
            await self.send_message(f"❌ 启动脚本失败：{str(e)}")
        finally:
            db.close()

    async def stop_script_bg(self, script_id):
        success = await scheduler.stop_script(script_id)
        status = "成功终止" if success else "停止失败 (脚本可能并未在运行)"
        await self.send_message(f"⏹️ *操作反馈：*{status}")

    async def run_health_check(self):
        await self.send_message("🔍 *正在进行全系统脚本扫描...*")
        issues = await scheduler.health_check()
        if not issues:
            await self.send_message("✅ *扫描完成：* 所有常驻进程运行正常。" )
        else:
            await self.send_message(f"⚠️ *异常警报：* 发现 {len(issues)} 个常驻脚本已失效。" )

    async def show_script_log(self, script_id):
        log_path = f"/app/data/logs/{script_id}.log"
        content = "🏮 尚未产生日志文件。"
        try:
            import os
            if os.path.exists(log_path):
                try:
                    with open(log_path, "r", encoding="utf-8", errors="replace") as f:
                        lines = f.readlines()
                        last_50 = "".join(lines[-50:]) if lines else "无日志内容"
                        content = f"📜 *最近 50 条日志记录：*\n\n```\n{last_50}\n```"
                except IOError as io_err:
                    logger.error(f"IO Error reading log {script_id}: {io_err}")
                    content = f"❌ 日志读取失败 (IO错误): {io_err}"
            else:
                logger.info(f"Log file not found: {log_path}")
        except Exception as e:
            logger.error(f"Error in show_script_log: {e}")
            content = f"❌ 日志读取失败: {e}"

        # Telegram消息长度限制4096字符，如果超过则截断
        if len(content) > 4000:
            content = content[:3900] + "\n... (日志过长已截断)"

        await self.send_message(content)

    async def set_my_commands(self):
        url = f"{self.base_url}/setMyCommands"
        commands = [
            {"command": "menu", "description": "📂 打开主菜单"},
            {"command": "start", "description": "🔄 重启机器人交互"}
        ]
        proxies = self.proxy if self.proxy else None
        async with httpx.AsyncClient(proxy=proxies, timeout=10.0) as client:
            try:
                await client.post(url, json={"commands": commands})
                logger.info("Bot commands menu set successfully.")
            except asyncio.TimeoutError:
                logger.error("Timeout setting bot commands")
            except Exception as e:
                logger.error(f"Failed to set bot commands: {e}")

    async def start_polling(self):
        self.is_running = True
        await self.set_my_commands()
        logger.info(f"Telegram Bot Polling Started (Proxy: {self.proxy}).")
        
        while self.is_running:
            if bot_instance != self:
                logger.warning("Zombie bot instance detected. Stopping.")
                self.is_running = False
                break

            try:
                updates = await self.get_updates()
                if updates and updates.get("conflict"):
                    self.is_running = False
                    logger.error("Conflict detected. Stopping polling loop.")
                    break

                if updates and updates.get("ok"):
                    for u in updates.get("result", []):
                        await self.handle_update(u)
            except Exception as e:
                logger.error(f"Polling loop error: {e}")
            
            await asyncio.sleep(2)

bot_instance = None
bot_task = None

async def stop_bot():
    global bot_instance, bot_task
    if bot_instance:
        bot_instance.is_running = False
        logger.info("Stopping Telegram Bot...")
    if bot_task:
        bot_task.cancel()
        try:
            await bot_task
        except asyncio.CancelledError:
            pass
    bot_instance = None
    bot_task = None

async def start_bot():
    global bot_instance, bot_task
    await stop_bot()
    db = database.SessionLocal()
    try:
        token_setting = db.query(models.Setting).filter(models.Setting.key == "tg_bot_token").first()
        chat_setting = db.query(models.Setting).filter(models.Setting.key == "tg_chat_id").first()
        proxy_setting = db.query(models.Setting).filter(models.Setting.key == "tg_proxy").first()
    finally:
        db.close()

    token = token_setting.value if token_setting else None
    chat_id = chat_setting.value if chat_setting else None
    proxy = proxy_setting.value if proxy_setting and proxy_setting.value else None

    # 验证token和chat_id格式
    if not token or not chat_id:
        logger.warning("Telegram settings missing in DB, bot not started.")
        return

    # 验证chat_id是否为有效的数字
    try:
        int(chat_id)
    except (ValueError, TypeError):
        logger.error(f"Invalid chat_id format in DB: {chat_id}. Expected numeric string.")
        return

    # 验证token格式 (Telegram token通常为 数字:字符串 的格式)
    if ":" not in token:
        logger.error(f"Invalid token format in DB. Expected format: 'bot_id:token'")
        return

    bot_instance = TelegramBot(token, chat_id, proxy)
    bot_task = asyncio.create_task(bot_instance.start_polling())
    logger.info(f"Telegram Bot started successfully with chat_id: {chat_id}")