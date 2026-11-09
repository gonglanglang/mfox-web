import { post } from './request'

/** 上传本地图片到 OSS。调用路径保持原来的 /oss/file，只把请求细节收回 API 层。 */
export async function uploadImageToOSS(file: File): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await post<{ url: string }>('/oss/file', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.url
}
