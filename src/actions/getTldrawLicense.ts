'use server'

export async function getTldrawLicense () {
    return process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY || ""
}