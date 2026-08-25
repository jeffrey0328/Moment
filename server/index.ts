import 'dotenv/config'
import { attachStatic, createApp } from './app.js'

const app = createApp()
attachStatic(app)

const port = Number(process.env.PORT || 8787)
app.listen(port, () => {
  console.log(`拾光记服务已启动：http://localhost:${port}`)
})
