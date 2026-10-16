import { redirect } from 'next/navigation'

// Old link, kept so existing bookmarks and posts still land on the renamed page.
export default function TwitterBotRedirect() {
  redirect('/app/auto-pay')
}
