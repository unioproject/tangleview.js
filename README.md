# tangleview.js

Tangleview Client Library for JavaScript

## Prerequisites

Add following scripts to the bottom of your `<body>` tag or to the equivalent place you integrate them in your project.

```html
<script src="js/lokijs.min.js" type="text/javascript"></script>
<script src="js/socket.io.min.js" type="text/javascript"></script>
<script src="js/tangleview.min.js" type="text/javascript"></script>
```

> **Note**: The order is important! `lokijs.min.js` and `socket.io.min.js` need to be called before `tangleview.min.js`

## Getting started

To implement tangleview into your project, add following line:

```js
const tangle = new tangleview({ host: "localhost", ssl: false });
```

**Options**\
_`host`_
The URL of your `tangleview` instance. If not specified, it will use the URL of the browser.\
_`ssl`_ If you have secure ssl enabled adapt this setting (calls `https://` instead of `http://`).

> **Note**: If you have tangleview installed on the URL which is used by your project, you can leave the options empty `{}`. If will automatically call the API according to the called URL of the browser.

## Tangle calls

Following calls and hooks to the `tangleview` instance are currently available:

#### getTxHistory()

Returns `Promise` / `Array` of TX objects

```js
tangle
  .getTxHistory({ amount: 15000 })
  .then(history => {
    console.log("Tangle history:", history);
  })
  .catch(err => {
    console.log("Error fetching Tangle history:", err);
  });
```

#### on('txNew');

Returns `object` of newly propagated TX.

```js
tangle.on("txNew", newTxObject => {
  console.log("New TX on Tangle:", newTxObject);
});
```

#### on('txConfirmed');

Returns `object` of newly discovered confirmation.

```js
tangle.on("txConfirmed", newTxConfirmationObject => {
  console.log("New confirmation on Tangle:", newTxConfirmationObject);
});
```

#### on('txReattaches');

Returns `object` of newly discovered reattachment.

```js
tangle.on("txReattaches", newTxReattachmentObject => {
  console.log("New reattachment on Tangle:", newTxReattachmentObject);
});
```

#### on('milestones');

Returns `object` of newly discovered milestone.

```js
tangle.on("milestones", newMilestoneObject => {
  console.log("New milestone on Tangle:", newMilestoneObject);
});
```
