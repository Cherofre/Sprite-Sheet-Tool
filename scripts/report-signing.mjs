const signingEnvKeys = [
  'CSC_LINK',
  'WIN_CSC_LINK',
  'CSC_KEY_PASSWORD',
  'WIN_CSC_KEY_PASSWORD',
  'CSC_NAME'
]

const availableKeys = signingEnvKeys.filter((key) => {
  const value = process.env[key]
  return typeof value === 'string' && value.trim().length > 0
})

if (availableKeys.length > 0) {
  console.log(`Signing inputs detected via environment: ${availableKeys.join(', ')}`)
  console.log('electron-builder will attempt Windows signing during packaging.')
} else {
  console.log('No Windows signing certificate was detected in the environment.')
  console.log('Installer and portable packages will be built unsigned unless CSC_LINK / WIN_CSC_LINK is provided.')
}
