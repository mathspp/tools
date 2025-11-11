# What time is it for me?

This tool helps compare a chosen moment across timezones and share it with others.

## Timezone inference
- On load, the app first attempts to detect the visitor's timezone via their IP address using the public `worldtimeapi.org` service.
- If the IP lookup fails, it falls back to the browser's reported timezone.
- The detected value is shown near the top of the page as “Your inferred timezone: &lt;zone&gt;”.
- The inferred timezone is used for the fixed comparison row and to preselect the timezone dropdown unless the visitor picks a different zone manually or via URL parameters.

## Comparison table
- Selecting a date, time, and timezone fills a comparison table.
- The table always includes the inferred local timezone plus any custom rows the visitor adds.
- Custom rows can be added with the “Add timezone” button and removed individually.
- Each row displays the converted time alongside its UTC offset.

## Sharing
- The “Copy link with this moment” button builds a URL with query parameters for the selected date, time, and timezone.
- The preview field shows the URL that will be copied so it can be shared manually if needed.
