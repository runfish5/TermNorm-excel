// utils/app-utilities.js
// General application utility functions

// Function to update content margin based on status bar height
export function updateContentMargin() {
  const statusBar = document.querySelector(".status-bar");
  if (statusBar) {
    const statusBarHeight = statusBar.offsetHeight;
    document.documentElement.style.setProperty("--status-bar-height", `${statusBarHeight}px`);
  }
}

// Utility function to get current workbook name
export async function getCurrentWorkbookName() {
  return await Excel.run(async (context) => {
    const wb = context.workbook;
    wb.load("name");
    await context.sync();
    return wb.name;
  });
}